import "server-only";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rate limiting for the endpoints that spend external question-provider quota.
 *
 * Keyed by authenticated user id, never by IP. Nigerian students routinely share
 * an address — university Wi-Fi, cyber cafés, school networks and carrier-grade
 * NAT all put many legitimate users behind one IP — so an IP-keyed limiter would
 * lock out a whole campus because of one heavy user.
 *
 * State lives in Postgres because the app runs on serverless instances that
 * share no memory. An in-process bucket would reset on every cold start and be
 * counted separately per instance; see `consume_rate_limit` for how atomicity is
 * guaranteed.
 */

export interface RateLimitPolicy {
  /** Used to build the bucket key. Must be stable across deploys. */
  readonly name: string;
  /** Requests allowed back-to-back from a full bucket. */
  readonly capacity: number;
  /** Sustained rate once the burst is spent. */
  readonly perHour: number;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Deliberately generous: these exist to stop a runaway script exhausting the
 * provider quota for everyone, not to ration ordinary study. A student who
 * genuinely starts a dozen practice sessions in an afternoon must never see a
 * 429. Every value is overridable per environment.
 */
export const RATE_LIMITS = {
  /** One practice session costs about one upstream request. */
  practiceCreate: {
    name: "practice_create",
    capacity: positiveNumber(process.env.RATE_LIMIT_PRACTICE_BURST, 12),
    perHour: positiveNumber(process.env.RATE_LIMIT_PRACTICE_PER_HOUR, 30),
  },
  /** One mock costs about six upstream requests, and runs for two hours. */
  mockCreate: {
    name: "mock_create",
    capacity: positiveNumber(process.env.RATE_LIMIT_MOCK_BURST, 3),
    perHour: positiveNumber(process.env.RATE_LIMIT_MOCK_PER_HOUR, 6),
  },
  /**
   * Revision spends no provider quota — it replays frozen questions — but it
   * reads and re-grades the student's whole history, so it is limited to protect
   * the database rather than the provider.
   */
  revisionCreate: {
    name: "revision_create",
    capacity: positiveNumber(process.env.RATE_LIMIT_REVISION_BURST, 10),
    perHour: positiveNumber(process.env.RATE_LIMIT_REVISION_PER_HOUR, 40),
  },
} as const satisfies Record<string, RateLimitPolicy>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface ConsumeRow {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
}

/**
 * Consumes one token for `userId` under `policy`.
 *
 * Fails closed. If the limiter cannot reach the database, neither can session
 * creation — the same client, the same database — so refusing here adds no new
 * outage, while failing open would remove the quota guard exactly when the
 * system is already unhealthy.
 */
export async function consumeRateLimit(
  policy: RateLimitPolicy,
  userId: string,
): Promise<RateLimitResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_key: `${policy.name}:${userId}`,
    p_capacity: policy.capacity,
    p_refill_per_second: policy.perHour / 3600,
    p_cost: 1,
  });

  if (error) {
    // The message can name database objects, so it stays in the server log and
    // never reaches the caller.
    console.error(`[rate-limit] ${policy.name} check failed: ${error.message}`);
    return { allowed: false, remaining: 0, retryAfterSeconds: 30 };
  }

  const row = (data as unknown as ConsumeRow[])?.[0];
  if (!row) {
    console.error(`[rate-limit] ${policy.name} returned no row`);
    return { allowed: false, remaining: 0, retryAfterSeconds: 30 };
  }

  return {
    allowed: row.allowed,
    remaining: Number(row.remaining),
    retryAfterSeconds: Number(row.retry_after_seconds),
  };
}

function humanWait(seconds: number): string {
  if (seconds <= 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`;
}

/** A 429 that tells the student what to do, and never names internal machinery. */
export function rateLimitedResponse(result: RateLimitResult): NextResponse {
  const seconds = Math.max(1, result.retryAfterSeconds);
  return NextResponse.json(
    {
      error: `You have started a lot of sessions in a short time. Please wait about ${humanWait(seconds)} and try again — your saved work is safe.`,
      code: "RATE_LIMITED",
    },
    {
      status: 429,
      headers: { "Retry-After": String(seconds), "Cache-Control": "no-store" },
    },
  );
}

/**
 * Applies `policy` and returns a ready 429 when the caller is over budget, or
 * null when the request may proceed.
 */
export async function enforceRateLimit(
  policy: RateLimitPolicy,
  userId: string,
): Promise<NextResponse | null> {
  const result = await consumeRateLimit(policy, userId);
  return result.allowed ? null : rateLimitedResponse(result);
}
