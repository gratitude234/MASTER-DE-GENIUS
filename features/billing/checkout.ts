import "server-only";

import { findPurchasablePlan, type BillingPlan } from "@/features/billing/plans";
import {
  appUrl,
  generatePaymentReference,
  initializePaystackTransaction,
  paystackConfigured,
  paystackEnvironment,
  PaystackError,
  type PaystackEnvironment,
} from "@/features/billing/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Checkout initialization.
 *
 * The browser submits one thing: a plan slug. Amount, currency and duration are
 * resolved from the server catalogue and re-resolved again inside
 * `open_billing_checkout`, so a request that also carries `amount: 100` is not
 * rejected as suspicious — the field simply has nowhere to go.
 *
 * The local pending payment row is written before Paystack is contacted. A
 * webhook that arrives while this request is still in flight therefore always
 * has a row to resolve, and a payment can never exist upstream without a local
 * record of what it was supposed to buy.
 *
 * Side effects are injected so the ordering and the amount actually sent can be
 * asserted in tests without a network or a database.
 */

export class BillingError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export interface OpenedCheckout {
  outcome: "created" | "reused";
  paymentId: string;
  reference: string;
  amountKobo: number;
  currency: string;
  accessDays: number;
  authorizationUrl: string | null;
}

export interface CheckoutDeps {
  /** Creates the pending row, or returns the fresh one a rapid retry already made. */
  openCheckout(input: {
    userId: string;
    planSlug: string;
    reference: string;
    environment: PaystackEnvironment;
  }): Promise<OpenedCheckout>;
  initializeTransaction(input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    planSlug: string;
  }): Promise<{ authorizationUrl: string }>;
  attachAuthorizationUrl(reference: string, authorizationUrl: string): Promise<void>;
  markUnsuccessful(reference: string, reason: string): Promise<void>;
  generateReference(): string;
  environment: PaystackEnvironment;
  appUrl: string;
}

/** Only the fields the browser needs. No provider payload, no secret, no amount it could edit. */
export interface CheckoutResult {
  reference: string;
  authorizationUrl: string;
  planSlug: string;
  planName: string;
  amountKobo: number;
  currency: string;
  accessDays: number;
  /** True when a rapid second click resolved to the first click's checkout. */
  reused: boolean;
}

/**
 * Resolves the one field a request may supply.
 *
 * `free` is a real plan and is deliberately refused here: it costs nothing, so
 * a checkout for it would create a payment that can never be verified, and a
 * zero-amount success path is exactly the kind of thing that later becomes a
 * free upgrade.
 */
export function resolveCheckoutPlan(rawSlug: unknown): BillingPlan {
  if (typeof rawSlug !== "string" || !rawSlug) {
    throw new BillingError("PLAN_REQUIRED", 400, "Choose a plan to continue.");
  }
  const plan = findPurchasablePlan(rawSlug);
  if (!plan) {
    throw new BillingError("PLAN_INVALID", 400, "That plan is not available for purchase.");
  }
  return plan;
}

/** Extracts the slug and nothing else. Any amount or duration in the body is ignored. */
export function parseCheckoutRequest(value: unknown): { planSlug: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BillingError("PLAN_REQUIRED", 400, "Choose a plan to continue.");
  }
  return { planSlug: resolveCheckoutPlan((value as Record<string, unknown>).planSlug).slug };
}

export function checkoutCallbackUrl(base: string, reference: string): string {
  return `${base.replace(/\/+$/, "")}/billing/callback?reference=${encodeURIComponent(reference)}`;
}

export async function startCheckout(
  params: { userId: string; email: string; planSlug: unknown },
  deps: CheckoutDeps,
): Promise<CheckoutResult> {
  const plan = resolveCheckoutPlan(params.planSlug);

  if (!params.email || !params.email.includes("@")) {
    throw new BillingError("EMAIL_UNAVAILABLE", 409, "Add a verified email to your account before paying.");
  }

  const opened = await deps.openCheckout({
    userId: params.userId,
    planSlug: plan.slug,
    reference: deps.generateReference(),
    environment: deps.environment,
  });

  // A double-tapped Pay button resolves to the checkout the first tap opened,
  // so one intent to pay never becomes two Paystack transactions.
  if (opened.outcome === "reused" && opened.authorizationUrl) {
    return {
      reference: opened.reference,
      authorizationUrl: opened.authorizationUrl,
      planSlug: plan.slug,
      planName: plan.name,
      amountKobo: opened.amountKobo,
      currency: opened.currency,
      accessDays: opened.accessDays,
      reused: true,
    };
  }

  try {
    // The amount comes from the row the database just wrote from its own
    // catalogue — not from `plan`, and certainly not from the request.
    const initialized = await deps.initializeTransaction({
      email: params.email,
      amountKobo: opened.amountKobo,
      reference: opened.reference,
      callbackUrl: checkoutCallbackUrl(deps.appUrl, opened.reference),
      planSlug: plan.slug,
    });

    await deps.attachAuthorizationUrl(opened.reference, initialized.authorizationUrl);

    return {
      reference: opened.reference,
      authorizationUrl: initialized.authorizationUrl,
      planSlug: plan.slug,
      planName: plan.name,
      amountKobo: opened.amountKobo,
      currency: opened.currency,
      accessDays: opened.accessDays,
      reused: false,
    };
  } catch (error) {
    // The pending row is closed out so it cannot be mistaken for an open
    // checkout later, and so the ledger records why nothing happened.
    await deps.markUnsuccessful(opened.reference, "initialization_failed").catch(() => {});
    if (error instanceof PaystackError) {
      throw new BillingError("PROVIDER", 503, "Payments are temporarily unavailable. Please try again shortly.");
    }
    throw error;
  }
}

interface OpenCheckoutRow {
  outcome: string;
  payment_id: string;
  reference: string;
  amount_kobo: number;
  currency: string;
  access_days: number;
  authorization_url: string | null;
}

/** The production wiring: real database, real Paystack, configured app URL. */
export function liveCheckoutDeps(): CheckoutDeps {
  const admin = createAdminClient();

  return {
    environment: paystackEnvironment(),
    appUrl: appUrl(),
    generateReference: generatePaymentReference,

    async openCheckout(input) {
      const { data, error } = await admin.rpc("open_billing_checkout", {
        p_user_id: input.userId,
        p_plan_slug: input.planSlug,
        p_reference: input.reference,
        p_environment: input.environment,
        p_reuse_seconds: 900,
      });

      if (error) {
        console.error(`[billing] checkout open failed: ${error.code ?? "unknown"}`);
        throw new BillingError("CHECKOUT_UNAVAILABLE", 503, "Payments are temporarily unavailable. Please try again shortly.");
      }

      const row = (data as unknown as OpenCheckoutRow[])?.[0];
      if (!row) {
        throw new BillingError("CHECKOUT_UNAVAILABLE", 503, "Payments are temporarily unavailable. Please try again shortly.");
      }

      return {
        outcome: row.outcome === "reused" ? "reused" : "created",
        paymentId: row.payment_id,
        reference: row.reference,
        amountKobo: Number(row.amount_kobo),
        currency: row.currency,
        accessDays: Number(row.access_days),
        authorizationUrl: row.authorization_url,
      };
    },

    async initializeTransaction(input) {
      const result = await initializePaystackTransaction(input);
      return { authorizationUrl: result.authorizationUrl };
    },

    async attachAuthorizationUrl(reference, authorizationUrl) {
      const { error } = await admin.rpc("attach_billing_authorization_url", {
        p_reference: reference,
        p_authorization_url: authorizationUrl,
      });
      if (error) console.error(`[billing] authorization url store failed: ${error.code ?? "unknown"}`);
    },

    async markUnsuccessful(reference, reason) {
      const { error } = await admin.rpc("mark_billing_payment_unsuccessful", {
        p_reference: reference,
        p_status: "failed",
        p_reason: reason,
      });
      if (error) console.error(`[billing] failure record failed: ${error.code ?? "unknown"}`);
    },
  };
}

export function assertPaystackConfigured(): void {
  if (!paystackConfigured()) {
    throw new BillingError("NOT_CONFIGURED", 503, "Payments are not available on this deployment yet.");
  }
}
