import "server-only";

import type { ActivePracticeSession } from "@/features/billing/usage-types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The student's unfinished practice session, account-wide.
 *
 * Deliberately not scoped to an exam body. The practice allowance is one
 * account-wide allowance — a student preparing for JAMB and WAEC has a single
 * daily session — so "is today's session still running?" cannot be answered by
 * looking at one exam. `getLatestActivePracticeSessionForUser` stays exam-scoped
 * because Practice Setup resumes within the exam the student is looking at.
 *
 * Deliberately a module of its own rather than a function on the practice
 * service: the dashboard and the usage summary need this one small read, and
 * the practice service pulls in the whole question-provider stack.
 *
 * An expired session is not active. The runner will not accept an answer after
 * `expires_at`, so offering "Resume" would send the student to a dead end — and
 * a timed session whose clock ran out is finished in every sense that matters
 * to the student, whatever its row still says.
 *
 * Reads only. It can never grant anything: the session route re-checks the
 * allowance under the reservation lock.
 */
export async function getActivePracticeSessionForUser(userId: string): Promise<ActivePracticeSession | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("practice_sessions")
    .select("id, subject_id, answered_count, question_count, expires_at")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error(`[practice] active session read failed: ${error.code ?? "unknown"}`);
    return null;
  }

  const live = (data ?? []).find((row) => !row.expires_at || Date.parse(row.expires_at) > Date.now());
  if (!live) return null;

  const { data: subject } = await admin
    .from("subjects")
    .select("name")
    .eq("id", live.subject_id)
    .maybeSingle();

  return {
    id: live.id,
    // A missing subject name must not hide a resumable session.
    subjectName: subject?.name ?? "Practice",
    answeredCount: live.answered_count,
    questionCount: live.question_count,
  };
}
