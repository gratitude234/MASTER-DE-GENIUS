import "server-only";

import { getEntitlement } from "@/features/billing/entitlements";
import { quotaWindow } from "@/features/billing/quota";
import type { PlanBadge, UsageMeter, UsageSummary } from "@/features/billing/usage-types";
import { getActivePracticeSessionForUser } from "@/features/practice/active-session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The server-side usage summary: what the student's plan allows, how much of it
 * is spent, and when it refills.
 *
 * Every number comes from the same tables the routes enforce against —
 * `product_usage_reservations` via `product_quota_usage`, and `ai_daily_usage`
 * via `ai_quota_usage` — through read-only functions that take no allowance.
 * Nothing here is trusted from the browser, and nothing it returns can grant
 * anything: the routes re-check under their own locks before creating anything.
 *
 * This is the single view model the dashboard, the practice setup screen, the
 * mock setup screen and the plan cards all read. A component that computed its
 * own "remaining" would be reporting a number nothing enforces.
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

  const [practiceUsed, mocksUsed, aiUsed, activeSession] = await Promise.all([
    countOrNull(() => db.rpc("product_quota_usage", {
      p_user_id: userId, p_capability: "practice_session", p_window_key: day.key,
    }), "practice session"),
    countOrNull(() => db.rpc("product_quota_usage", {
      p_user_id: userId, p_capability: "mock_attempt", p_window_key: mockWindow.key,
    }), "mock"),
    countOrNull(() => db.rpc("ai_quota_usage", { p_user_id: userId, p_feature: "question_explanation" }), "AI"),
    /*
     * Read for every tier, not only Free. Master's dashboard resumes an
     * unfinished session from the same field, and branching here would mean the
     * one view model described two different products.
     */
    getActivePracticeSessionForUser(userId),
  ]);

  return {
    tier: entitlement.tier,
    isMaster: entitlement.isMaster,
    masterUntil: entitlement.isMaster ? entitlement.expiresAt : null,
    practice: {
      ...meter(limits.practice.sessionsPerDay, practiceUsed, day.resetAt, "day"),
      maxQuestionsPerSession: limits.practice.maxQuestionsPerSession,
      activeSession,
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
