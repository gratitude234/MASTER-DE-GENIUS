import "server-only";

import { getEntitlement } from "@/features/billing/entitlements";
import type { BillingTier, TierLimits } from "@/features/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Plan entitlement quotas: new practice sessions, full mock attempts, and the
 * shared calendar every allowance resets on.
 *
 * This is not the provider abuse limiter in lib/rate-limit.ts. That one exists
 * to stop a runaway script draining the question provider's credits for
 * everybody and applies to Free and Master alike; this one is the product
 * itself. Conflating them would mean either paying students hitting an abuse
 * ceiling or free students being handed provider budget they did not buy.
 *
 * State lives in PostgreSQL because the app runs on serverless instances that
 * share no memory. An in-process `Map` would reset on every cold start and be
 * counted separately per instance, which is not a quota at all.
 *
 * Allowance is reserved before the upstream provider is called and only
 * committed once a session or attempt actually exists — a provider outage
 * therefore costs the student nothing.
 */

export type QuotaCapability = "practice_session" | "mock_attempt";

export interface QuotaWindow {
  /** The key the database counts against. */
  key: string;
  kind: "day" | "month";
  /** The instant the allowance next refills (midnight in Lagos). */
  resetAt: Date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The calendar every allowance is counted on. */
export const QUOTA_TIME_ZONE = "Africa/Lagos";

/**
 * West Africa Time is UTC+1 all year — Nigeria observes no daylight saving — so
 * a fixed offset is exact. PostgreSQL's `product_quota_day()` uses the named
 * zone, and the database tests assert the two agree either side of midnight.
 */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/**
 * Windows are computed on the server, on the Lagos calendar.
 *
 * A device-local window would let a student roll their allowance over by
 * changing the phone clock, and would make "resets at midnight" mean different
 * things for the same student on two devices. UTC would make it mean 1am for
 * every student this product serves.
 */
export function quotaWindow(kind: "day" | "month", now: Date = new Date()): QuotaWindow {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();

  if (kind === "month") {
    return {
      key: `${year}-${pad(month + 1)}`,
      kind,
      resetAt: new Date(Date.UTC(year, month + 1, 1) - LAGOS_OFFSET_MS),
    };
  }

  const day = local.getUTCDate();
  return {
    key: `${year}-${pad(month + 1)}-${pad(day)}`,
    kind,
    resetAt: new Date(Date.UTC(year, month, day + 1) - LAGOS_OFFSET_MS),
  };
}

export function capabilityLimit(capability: QuotaCapability, limits: TierLimits): {
  limit: number;
  windowKind: "day" | "month";
} {
  return capability === "practice_session"
    ? { limit: limits.practice.sessionsPerDay, windowKind: "day" }
    : { limit: limits.mockAttempts, windowKind: limits.mockAttemptWindow };
}

export interface QuotaReservation {
  allowed: boolean;
  /** Present only when allowed; must be committed or released. */
  reservationId: string | null;
  limit: number;
  used: number;
  remaining: number;
  tier: BillingTier;
  window: QuotaWindow;
}

interface ReserveRow {
  allowed: boolean;
  used: number;
  remaining: number;
  reservation_id: string | null;
}

/**
 * Takes one unit of `capability` for `userId` at their current plan's limit.
 *
 * Fails closed. If the quota table cannot be reached, neither can session
 * creation — the same database, the same client — so refusing here adds no new
 * outage, while failing open would hand every student unlimited paid capacity
 * exactly when the system is already unhealthy.
 */
export async function reserveCapability(
  userId: string,
  capability: QuotaCapability,
  now: Date = new Date(),
): Promise<QuotaReservation> {
  const entitlement = await getEntitlement(userId);
  const { limit, windowKind } = capabilityLimit(capability, entitlement.limits);
  const window = quotaWindow(windowKind, now);

  const base = { limit, tier: entitlement.tier, window };

  try {
    const { data, error } = await createAdminClient().rpc("reserve_product_quota", {
      p_user_id: userId,
      p_capability: capability,
      p_window_key: window.key,
      p_limit: limit,
      p_lease_seconds: 120,
    });

    if (error) {
      console.error(`[billing] ${capability} reservation failed: ${error.code ?? "unknown"}`);
      return { ...base, allowed: false, reservationId: null, used: limit, remaining: 0 };
    }

    const row = (data as unknown as ReserveRow[])?.[0];
    if (!row) {
      console.error(`[billing] ${capability} reservation returned no row`);
      return { ...base, allowed: false, reservationId: null, used: limit, remaining: 0 };
    }

    return {
      ...base,
      allowed: row.allowed,
      reservationId: row.reservation_id,
      used: Number(row.used),
      remaining: Number(row.remaining),
    };
  } catch {
    console.error(`[billing] ${capability} reservation failed`);
    return { ...base, allowed: false, reservationId: null, used: limit, remaining: 0 };
  }
}

/** The session or attempt exists. The allowance is genuinely spent. */
export async function commitCapability(reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  try {
    const { error } = await createAdminClient().rpc("commit_product_quota", {
      p_reservation_id: reservationId,
    });
    // An uncommitted reservation expires on its own lease, so a bookkeeping
    // failure must never turn a created session into a failed request.
    if (error) console.error(`[billing] quota commit failed: ${error.code ?? "unknown"}`);
  } catch {
    console.error("[billing] quota commit failed");
  }
}

/**
 * Nothing was created — the provider failed, a duplicate was suppressed, or an
 * existing attempt was resumed. The allowance goes straight back rather than
 * waiting out the lease.
 */
export async function releaseCapability(reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  try {
    const { error } = await createAdminClient().rpc("release_product_quota", {
      p_reservation_id: reservationId,
    });
    if (error) console.error(`[billing] quota release failed: ${error.code ?? "unknown"}`);
  } catch {
    console.error("[billing] quota release failed");
  }
}
