import "server-only";

import { AI_PROMPT_VERSION, AI_PROVIDER } from "@/features/ai/config";
import type { ExplanationType } from "@/features/ai/types";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AiUsageEntry {
  userId: string;
  explanationType: ExplanationType;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheHit: boolean;
  durationMs: number;
  status: "ok" | "failed";
  errorCategory?: string | null;
}

/** Best-effort bookkeeping; never turn a useful explanation into a failure. */
export async function recordAiUsage(entry: AiUsageEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("ai_usage").insert({
      user_id: entry.userId,
      feature: "question_explanation",
      explanation_type: entry.explanationType,
      provider: AI_PROVIDER,
      model: entry.model,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      cache_hit: entry.cacheHit,
      duration_ms: Math.max(0, Math.round(entry.durationMs)),
      status: entry.status,
      error_category: entry.errorCategory ?? null,
      prompt_version: AI_PROMPT_VERSION,
    });
    if (error) console.error("[ai] usage record failed", { code: error.code });
  } catch {
    console.error("[ai] usage record failed");
  }
}

