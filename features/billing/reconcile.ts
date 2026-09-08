import "server-only";

import { BillingError } from "@/features/billing/checkout";
import { findPlan } from "@/features/billing/plans";
import {
  paystackEnvironment,
  PaystackError,
  verifyPaystackTransaction,
} from "@/features/billing/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The browser callback, reconciled server-side.
 *
 * Paystack redirects the student back with a reference in the URL. That
 * redirect is not evidence of anything: it is a GET the student's browser
 * performed, so its query string is fully under their control. The reference is
 * therefore used only to look up a payment that this server already created for
 * this user — never to learn a price, a duration, a plan or an account.
 *
 * The webhook usually settles the payment first. This path exists for when it
 * has not yet: it verifies against Paystack and applies through exactly the
 * same locked function the webhook uses, so a callback racing a webhook results
 * in one grant and one `already_applied`.
 */

export type ReconcileState = "success" | "pending" | "failed" | "abandoned" | "unknown";

export interface ReconcileResult {
  state: ReconcileState;
  reference: string;
  planSlug: string | null;
  planName: string | null;
  amountKobo: number | null;
  accessDays: number | null;
  /** Master expiry after a successful application. */
  expiresAt: string | null;
  /** True when the entitlement is confirmed active locally, not merely paid upstream. */
  activated: boolean;
}

function unknownResult(reference: string): ReconcileResult {
  return {
    state: "unknown",
    reference,
    planSlug: null,
    planName: null,
    amountKobo: null,
    accessDays: null,
    expiresAt: null,
    activated: false,
  };
}

/** A reference the browser hands back is untrusted input before it is anything else. */
export function parseReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 100) return null;
  return /^[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : null;
}

interface ApplyRow {
  outcome: string;
  expires_at: string | null;
}

/**
 * Resolves the status of one reference for one authenticated user.
 *
 * The `user_id` filter is the whole security model of this function: a
 * reference belonging to somebody else returns `unknown`, which is the same
 * answer a made-up reference gets, so the endpoint cannot be used to discover
 * whether a reference exists.
 */
export async function reconcilePayment(userId: string, rawReference: unknown): Promise<ReconcileResult> {
  const reference = parseReference(rawReference);
  if (!reference) throw new BillingError("REFERENCE_INVALID", 400, "That payment reference is not valid.");

  const admin = createAdminClient();
  const { data: payment, error } = await admin
    .from("payment_transactions")
    .select("reference, plan_slug, amount_kobo, access_days, status, environment, entitlement_expires_at")
    .eq("reference", reference)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(`[billing] reconcile lookup failed: ${error.code ?? "unknown"}`);
    throw new BillingError("RECONCILE_UNAVAILABLE", 503, "We could not check this payment. Please try again shortly.");
  }
  if (!payment) return unknownResult(reference);

  const plan = findPlan(payment.plan_slug);
  const base = {
    reference,
    planSlug: payment.plan_slug,
    planName: plan?.name ?? payment.plan_slug,
    amountKobo: payment.amount_kobo,
    accessDays: payment.access_days,
  };

  if (payment.status === "success") {
    return { ...base, state: "success", expiresAt: payment.entitlement_expires_at, activated: true };
  }
  if (payment.status === "failed" || payment.status === "reversed") {
    return { ...base, state: "failed", expiresAt: null, activated: false };
  }
  if (payment.status === "abandoned") {
    return { ...base, state: "abandoned", expiresAt: null, activated: false };
  }

  // Still pending locally. Ask Paystack directly rather than making the student
  // wait on a webhook that may be seconds or minutes away.
  let verified;
  try {
    verified = await verifyPaystackTransaction(reference);
  } catch (cause) {
    if (cause instanceof PaystackError) {
      return { ...base, state: "pending", expiresAt: null, activated: false };
    }
    throw cause;
  }

  if (verified.status === "abandoned") {
    await admin.rpc("mark_billing_payment_unsuccessful", {
      p_reference: reference,
      p_status: "abandoned",
      p_reason: "verified_status_abandoned",
      p_provider_status: verified.status,
    });
    return { ...base, state: "abandoned", expiresAt: null, activated: false };
  }

  if (verified.status === "failed") {
    await admin.rpc("mark_billing_payment_unsuccessful", {
      p_reference: reference,
      p_status: "failed",
      p_reason: "verified_status_failed",
      p_provider_status: verified.status,
    });
    return { ...base, state: "failed", expiresAt: null, activated: false };
  }

  if (verified.status !== "success") {
    return { ...base, state: "pending", expiresAt: null, activated: false };
  }

  // Currency and environment are re-checked here as well as in the RPC so the
  // callback path can never be the weaker of the two entry points.
  if (verified.currency !== "NGN" || verified.environment !== paystackEnvironment()) {
    console.error("[billing] callback verification rejected on currency or environment");
    return { ...base, state: "pending", expiresAt: null, activated: false };
  }

  const { data, error: applyError } = await admin.rpc("apply_successful_payment", {
    p_reference: reference,
    p_amount_kobo: verified.amountKobo,
    p_currency: verified.currency,
    p_environment: verified.environment,
    p_provider_transaction_id: verified.providerTransactionId,
    p_provider_status: verified.status,
    p_paid_at: verified.paidAt,
  });

  if (applyError) {
    console.error(`[billing] callback application failed: ${applyError.code ?? "unknown"}`);
    return { ...base, state: "pending", expiresAt: null, activated: false };
  }

  const row = (data as unknown as ApplyRow[])?.[0];
  if (row?.outcome === "applied" || row?.outcome === "already_applied") {
    return { ...base, state: "success", expiresAt: row.expires_at, activated: true };
  }

  // A mismatch on amount, currency or environment lands here. The student is
  // told it is unresolved, never that it succeeded, and the reason stays in the
  // server log rather than being handed to the browser.
  console.error(`[billing] callback application refused: ${row?.outcome ?? "unknown"}`);
  return { ...base, state: "pending", expiresAt: null, activated: false };
}
