import "server-only";

import { cache } from "react";

import {
  BILLING_PLANS,
  findPlan,
  limitsForTier,
  type BillingPlan,
  type BillingTier,
  type TierLimits,
} from "@/features/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The single server-side authority on what a student is currently allowed to do.
 *
 * Nothing else in the application may decide a tier. Hiding a button is a
 * courtesy to the student, never an authorization decision — every paid
 * capability is gated here or in the PostgreSQL function this calls, so
 * flipping a flag in devtools unlocks nothing.
 *
 * Tier is read from `user_entitlements` and never from `user_metadata` or a JWT
 * claim: those are shaped by the account holder and would make Master
 * self-service.
 */

export interface Entitlement {
  tier: BillingTier;
  /** Null for Free. */
  plan: BillingPlan | null;
  /** The stored expiry, even when it is in the past — the billing page shows it. */
  expiresAt: string | null;
  isMaster: boolean;
  limits: TierLimits;
}

export const FREE_ENTITLEMENT: Entitlement = {
  tier: "free",
  plan: null,
  expiresAt: null,
  isMaster: false,
  limits: limitsForTier("free"),
};

interface EntitlementRow {
  tier: string | null;
  plan_slug: string | null;
  expires_at: string | null;
}

/**
 * Turns a stored row into a resolved entitlement.
 *
 * Expiry is applied here rather than by a scheduled downgrade, so lapsed Master
 * access becomes Free at the instant it expires — there is no window in which a
 * stale row still authorizes anything, and no job that can fail to run.
 */
export function resolveEntitlement(row: EntitlementRow | null, now: Date = new Date()): Entitlement {
  if (!row || row.tier !== "master" || !row.expires_at) {
    return { ...FREE_ENTITLEMENT, expiresAt: row?.expires_at ?? null };
  }

  const expiry = Date.parse(row.expires_at);
  const active = Number.isFinite(expiry) && expiry > now.getTime();

  if (!active) {
    return { ...FREE_ENTITLEMENT, expiresAt: row.expires_at };
  }

  return {
    tier: "master",
    plan: findPlan(row.plan_slug),
    expiresAt: row.expires_at,
    isMaster: true,
    limits: limitsForTier("master"),
  };
}

/**
 * The current entitlement, resolved once per request.
 *
 * Practice creation, the AI route, the shell and the pricing page all need it,
 * and `cache` collapses those into a single round trip for the whole render or
 * request. It fails closed to Free: a billing lookup that cannot complete must
 * degrade a paying student to free limits for one request, never hand Master to
 * everybody.
 */
export const getEntitlement = cache(async (userId: string): Promise<Entitlement> => {
  try {
    const { data, error } = await createAdminClient()
      .from("user_entitlements")
      .select("tier, plan_slug, expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error(`[billing] entitlement lookup failed: ${error.code ?? "unknown"}`);
      return FREE_ENTITLEMENT;
    }
    return resolveEntitlement(data);
  } catch {
    console.error("[billing] entitlement lookup failed");
    return FREE_ENTITLEMENT;
  }
});

export async function getTier(userId: string): Promise<BillingTier> {
  return (await getEntitlement(userId)).tier;
}

export async function isMasterActive(userId: string): Promise<boolean> {
  return (await getEntitlement(userId)).isMaster;
}

export async function getLimits(userId: string): Promise<TierLimits> {
  return (await getEntitlement(userId)).limits;
}

/**
 * The server-side gate for a Master-only action.
 *
 * Returns null when access is allowed, or the reason to refuse. Callers must
 * treat a non-null result as a hard stop; there is no client-side equivalent.
 */
export async function denyIfNotMaster(userId: string): Promise<"MASTER_REQUIRED" | null> {
  return (await isMasterActive(userId)) ? null : "MASTER_REQUIRED";
}

export interface PaymentHistoryEntry {
  id: string;
  planSlug: string;
  planName: string;
  reference: string;
  /** The reference, shortened for display. The full value stays server-side. */
  maskedReference: string;
  amountKobo: number;
  currency: string;
  status: string;
  accessDays: number;
  paidAt: string | null;
  createdAt: string;
  entitlementExpiresAt: string | null;
  /** True when the billing page offers this payment a re-check. See below. */
  recoverable: boolean;
}

/**
 * How stale a pending payment may be and still be worth re-checking.
 *
 * A payment that was paid but never settled locally — the student closed the
 * tab before the callback ran and the webhook never arrived — stays pending for
 * ever otherwise. Two weeks is long enough to cover a student who only noticed
 * days later, and short enough that the offer disappears rather than becoming a
 * permanent button on abandoned checkouts.
 */
const RECOVERABLE_PENDING_WINDOW_MS = 14 * 86_400_000;

/**
 * At most this many payments carry the offer.
 *
 * Each re-check costs one Paystack verification, so the bound is on the page
 * rather than on the student's patience. Three is more than a genuinely stuck
 * student ever has; a hundred abandoned checkouts get nothing.
 */
const RECOVERABLE_PENDING_LIMIT = 3;

/**
 * Marks the few recent pending payments the billing page may offer to re-check.
 *
 * This decides only what the page *offers*. It grants nothing and verifies
 * nothing: the re-check itself goes through `/api/billing/verify`, which
 * authenticates the student, scopes the reference to their own account, asks
 * Paystack directly, and applies through `apply_successful_payment` like every
 * other path. A pending row is never evidence of payment on its own.
 */
export function markRecoverablePayments<T extends { status: string; createdAt: string }>(
  entries: T[],
  now: Date = new Date(),
): (T & { recoverable: boolean })[] {
  let offered = 0;
  const floor = now.getTime() - RECOVERABLE_PENDING_WINDOW_MS;

  return entries.map((entry) => {
    if (entry.status !== "pending" || offered >= RECOVERABLE_PENDING_LIMIT) {
      return { ...entry, recoverable: false };
    }
    const created = Date.parse(entry.createdAt);
    const recoverable = Number.isFinite(created) && created >= floor;
    if (recoverable) offered += 1;
    return { ...entry, recoverable };
  });
}

export interface BillingSummary {
  entitlement: Entitlement;
  payments: PaymentHistoryEntry[];
}

/**
 * A reference is not a secret, but it is an identifier a support conversation
 * quotes out loud and a screenshot travels with, so only its ends are shown.
 */
export function maskReference(reference: string): string {
  if (reference.length <= 12) return reference;
  return `${reference.slice(0, 8)}…${reference.slice(-4)}`;
}

const planNames = new Map(BILLING_PLANS.map((plan) => [plan.slug, plan.name]));

/**
 * Everything the billing page renders, in one pass.
 *
 * Only the columns a student may see are selected. Provider transaction ids,
 * provider status strings, failure reasons and checkout URLs are deliberately
 * absent from this projection as well as from the browser's column grants.
 */
export async function getBillingSummary(userId: string): Promise<BillingSummary> {
  const entitlement = await getEntitlement(userId);

  const { data, error } = await createAdminClient()
    .from("payment_transactions")
    .select("id, plan_slug, reference, amount_kobo, currency, status, access_days, paid_at, created_at, entitlement_expires_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error(`[billing] payment history lookup failed: ${error.code ?? "unknown"}`);
    return { entitlement, payments: [] };
  }

  const payments: PaymentHistoryEntry[] = markRecoverablePayments(
    (data ?? []).map((row) => ({
      id: row.id,
      planSlug: row.plan_slug,
      planName: planNames.get(row.plan_slug) ?? row.plan_slug,
      reference: row.reference,
      maskedReference: maskReference(row.reference),
      amountKobo: row.amount_kobo,
      currency: row.currency,
      status: row.status,
      accessDays: row.access_days,
      paidAt: row.paid_at,
      createdAt: row.created_at,
      entitlementExpiresAt: row.entitlement_expires_at,
    })),
  );

  return { entitlement, payments };
}
