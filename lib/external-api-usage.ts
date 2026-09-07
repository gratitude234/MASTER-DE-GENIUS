import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { QuestionRequestType } from "@/features/questions/types";

export interface ExternalApiUsageEntry {
  provider: string;
  endpoint: string;
  requestType: QuestionRequestType;
  examBody?: string | null;
  subject?: string | null;
  requestedQuestionCount?: number | null;
  questionCount: number;
  httpStatus?: number | null;
  outcome: "ok" | "retry" | "failed";
  durationMs: number;
  creditsUsed?: number | null;
  creditsRemaining?: number | null;
  providerRequestId?: string | null;
}

/**
 * Best-effort operational telemetry. A bookkeeping outage must never turn a
 * successful question response into a student-visible failure.
 */
export async function recordExternalApiUsage(entry: ExternalApiUsageEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("external_api_usage").insert({
      provider: entry.provider,
      endpoint: entry.endpoint,
      request_type: entry.requestType,
      exam_body: entry.examBody ?? null,
      subject: entry.subject ?? null,
      requested_question_count: entry.requestedQuestionCount ?? null,
      question_count: entry.questionCount,
      http_status: entry.httpStatus ?? null,
      outcome: entry.outcome,
      duration_ms: Math.max(0, Math.round(entry.durationMs)),
      credits_used: entry.creditsUsed ?? null,
      credits_remaining: entry.creditsRemaining ?? null,
      provider_request_id: entry.providerRequestId ?? null,
    });
    if (error) console.error("[questions] external usage record failed", { provider: entry.provider, code: error.code });
  } catch {
    console.error("[questions] external usage record failed", { provider: entry.provider });
  }
}
