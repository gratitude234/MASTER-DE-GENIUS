import "server-only";

import { getEntitlement } from "@/features/billing/entitlements";
import { practiceMeterFor, quotaWindow, readPracticeAllowance } from "@/features/billing/quota";
import type { PlanBadge, UsageMeter, UsageSummary } from "@/features/billing/usage-types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The server-side usage summary: what the student's plan allows, how much of it
 * is spent, and when it refills.
 *
 * Every number comes from the same tables and functions the routes enforce
 * against — the practice-question ledger, `product_usage_reservations` and
 * `ai_daily_usage` — through read-only functions that take no allowance. Nothing
 * here is trusted from the browser, and nothing it returns can grant anything:
 * the routes re-check under their own locks.
 *
 * It reads; it never fails a page. An unreadable counter is reported as null so
 * the screen can show the allowance without inventing what is left of it.
 */

function meter(limit: number, used: number | null, resetAt: Date, window: "day" | "month"): UsageMeter {
  return {
    limit,
    used,
    remaining: used === null ? null : Math.max(0, limit - used),
    resetAt: resetAt.toISOString(),
    window,
  };
}

async function countOrNull(run: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>, label: string) {
  try {
    const { data, error } = await run();
    if (error || typeof data !== "number") {
      console.error(`[billing] ${label} usage read failed: ${error?.code ?? "unexpected shape"}`);
      return null;
    }
    return data;
  } catch {
    console.error(`[billing] ${label} usage read failed`);
    return null;
  }
}

export async function getUsageSummary(userId: string, now: Date = new Date()): Promise<UsageSummary> {
  const entitlement = await getEntitlement(userId);
  const { limits } = entitlement;
  const day = quotaWindow("day", now);
  const mockWindow = quotaWindow(limits.mockAttemptWindow, now);
  const db = createAdminClient();
  const practiceMeter = practiceMeterFor(entitlement, now);

  const [practiceAllowance, practiceSessions, mocksUsed, aiUsed] = await Promise.all([
    practiceMeter ? readPracticeAllowance(userId, practiceMeter) : Promise.resolve(null),
    practiceMeter
      ? Promise.resolve(null)
      : countOrNull(() => db.rpc("product_quota_usage", {
          p_user_id: userId, p_capability: "practice_session", p_window_key: day.key,
        }), "practice session"),
    countOrNull(() => db.rpc("product_quota_usage", {
      p_user_id: userId, p_capability: "mock_attempt", p_window_key: mockWindow.key,
    }), "mock"),
    countOrNull(() => db.rpc("ai_quota_usage", { p_user_id: userId, p_feature: "question_explanation" }), "AI"),
  ]);

  const practiceUsed = practiceMeter ? practiceAllowance?.used ?? null : practiceSessions;

  return {
    tier: entitlement.tier,
    isMaster: entitlement.isMaster,
    masterUntil: entitlement.isMaster ? entitlement.expiresAt : null,
    practice: {
      ...meter(limits.practice.perDay, practiceUsed, day.resetAt, "day"),
      // The ledger computes remaining itself (finished-unanswered questions count
      // as used), so its answer is taken verbatim rather than re-derived.
      remaining: practiceMeter ? practiceAllowance?.remaining ?? null : meter(limits.practice.perDay, practiceUsed, day.resetAt, "day").remaining,
      unit: limits.practice.unit,
      waiting: practiceAllowance?.waiting ?? null,
      available: practiceAllowance?.available ?? null,
    },
    mocks: meter(limits.mockAttempts, mocksUsed, mockWindow.resetAt, limits.mockAttemptWindow),
    aiExplanations: meter(limits.aiExplanationsPerDay, aiUsed, day.resetAt, "day"),
  };
}

/** Just enough for the shell to choose between "Upgrade to Master" and a plan badge. */
export async function getPlanBadge(userId: string): Promise<PlanBadge> {
  const entitlement = await getEntitlement(userId);
  return { tier: entitlement.tier, masterUntil: entitlement.isMaster ? entitlement.expiresAt : null };
}
