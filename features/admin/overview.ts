import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type Counts<K extends string> = Record<K, number>;

/**
 * Every figure the overview can show. A section is absent when the admin's
 * role does not include it: the database omits it, so the page cannot leak a
 * number by accident.
 */
export interface OverviewMetrics {
  students?: Counts<"total" | "onboarded" | "new_7d" | "new_30d">;
  exam_split?: Record<string, number>;
  active_students?: Counts<"d7" | "d30">;
  learning?: Counts<"practice_completed_7d" | "practice_completed_30d" | "mocks_submitted_7d" | "mocks_submitted_30d" | "practice_questions_30d" | "practice_correct_30d">;
  monetisation?: Counts<"active_master" | "payments_30d" | "revenue_7d_kobo" | "revenue_30d_kobo" | "revenue_all_kobo" | "unsuccessful_30d" | "test_payments_30d" | "manual_grants_30d">;
  leads?: Counts<"new" | "contacted" | "interested" | "follow_up" | "enrolled" | "not_interested" | "closed" | "created_7d" | "waiting_over_24h" | "unassigned_open">;
  support?: Counts<"open" | "in_progress" | "unassigned">;
  questions?: Counts<"active" | "pending_review" | "flagged" | "blocked_external">;
  session_health?: Counts<"overdue_mocks" | "overdue_timed_practice">;
  platform_health?: Counts<"provider_requests_24h" | "provider_failures_24h" | "ai_requests_7d" | "ai_failures_7d" | "webhook_rejected_7d" | "webhook_unfinished"> & { provider_last_ok_at: string | null };
}

/** Postgres counts arrive as numbers or numeric strings; both become numbers. */
function numbers(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, Number(item) || 0]));
}

export async function loadOverviewMetrics(actorId: string): Promise<OverviewMetrics> {
  const { data, error } = await createAdminClient().rpc("admin_overview_metrics", { p_actor_id: actorId });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("Could not load overview metrics.");

  const raw = data as Record<string, unknown>;
  const metrics: OverviewMetrics = {};
  for (const key of ["students", "exam_split", "active_students", "learning", "monetisation", "leads", "support", "questions", "session_health"] as const) {
    if (raw[key]) (metrics as Record<string, unknown>)[key] = numbers(raw[key]);
  }
  if (raw.platform_health && typeof raw.platform_health === "object") {
    const health = raw.platform_health as Record<string, unknown>;
    metrics.platform_health = {
      ...(numbers(health) as OverviewMetrics["platform_health"] & object),
      provider_last_ok_at: typeof health.provider_last_ok_at === "string" ? health.provider_last_ok_at : null,
    };
  }
  return metrics;
}
