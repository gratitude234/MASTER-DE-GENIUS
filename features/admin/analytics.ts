import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export interface WeeklyRow {
  weekStart: string;
  registrations: number;
  onboarded: number;
  activeStudents: number;
  practiceCompleted: number;
  revisionSessions: number;
  mocksSubmitted: number;
  aiGenerated: number;
  aiCached: number;
  aiFailed: number;
  /** Absent when the admin's role excludes payments. */
  purchases?: number;
  revenueKobo?: number;
  firstPurchases?: number;
  /** Absent when the admin's role excludes the class pipeline. */
  leadsCreated?: number;
  leadsContacted?: number;
  leadsEnrolled?: number;
}

function optional(row: Record<string, unknown>, key: string): number | undefined {
  return key in row ? Number(row[key]) || 0 : undefined;
}

export async function loadWeeklyAnalytics(actorId: string, weeks = 8): Promise<WeeklyRow[]> {
  const { data, error } = await createAdminClient().rpc("admin_weekly_analytics", { p_actor_id: actorId, p_weeks: weeks });
  if (error || !Array.isArray(data)) throw new Error("Could not load analytics.");

  return data.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      weekStart: String(row.week_start ?? ""),
      registrations: Number(row.registrations) || 0,
      onboarded: Number(row.onboarded) || 0,
      activeStudents: Number(row.active_students) || 0,
      practiceCompleted: Number(row.practice_completed) || 0,
      revisionSessions: Number(row.revision_sessions) || 0,
      mocksSubmitted: Number(row.mocks_submitted) || 0,
      aiGenerated: Number(row.ai_generated) || 0,
      aiCached: Number(row.ai_cached) || 0,
      aiFailed: Number(row.ai_failed) || 0,
      purchases: optional(row, "purchases"),
      revenueKobo: optional(row, "revenue_kobo"),
      firstPurchases: optional(row, "first_purchases"),
      leadsCreated: optional(row, "leads_created"),
      leadsContacted: optional(row, "leads_contacted"),
      leadsEnrolled: optional(row, "leads_enrolled"),
    };
  });
}

export interface AcademicRow {
  exam_code: string;
  subject_slug: string;
  subject_name: string;
  questions: number;
  correct: number;
  incorrect?: number;
  unanswered?: number;
  sessions?: number;
  students: number;
  accuracy: number;
  topic_slug?: string | null;
  topic_name?: string;
}

export interface AcademicQuestionRow {
  source_provider: string;
  exam_code: string;
  subject_slug: string;
  subject_name: string;
  source_question_id: string;
  internal_question_id: string | null;
  topic_name: string | null;
  prompt: string | null;
  attempts: number;
  correct: number;
  students: number;
  accuracy: number;
  is_blocked: boolean;
}

export interface AcademicReport {
  window: { since: string; until: string; min_attempts: number };
  totals: { questions: number; correct: number; unanswered: number; sessions: number; students: number };
  subjects: AcademicRow[];
  topics: AcademicRow[];
  questions: AcademicQuestionRow[];
  repeated: { exam_code: string; subject_name: string; topic_name: string; repeat_misses: number; students: number }[];
}

export async function loadAcademicReport(
  actorId: string,
  filters: { exam?: string; subject?: string; since: string; until: string; minAttempts: number },
): Promise<AcademicReport> {
  const { data, error } = await createAdminClient().rpc("admin_academic_performance", {
    p_actor_id: actorId,
    p_exam_code: filters.exam ?? null,
    p_subject_slug: filters.subject ?? null,
    p_since: filters.since,
    p_until: filters.until,
    p_min_attempts: filters.minAttempts,
  });
  if (error || !data || typeof data !== "object") throw new Error("Could not load academic performance.");
  return data as unknown as AcademicReport;
}
