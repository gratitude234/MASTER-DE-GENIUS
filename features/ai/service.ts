import "server-only";

import { createHash } from "node:crypto";

import {
  AI_CACHE_TTL_SECONDS,
  AI_PROMPT_VERSION,
  AI_PROVIDER,
  aiExplanationsEnabled,
  geminiModel,
} from "@/features/ai/config";
import { getEntitlement } from "@/features/billing/entitlements";
import { planLimitNotice, planLimitText, type PlanLimitNotice } from "@/features/billing/limit-notice";
import { quotaWindow } from "@/features/billing/quota";
import { explanationAccessDenial } from "@/features/ai/policy";
import { buildQuestionExplanationPrompt } from "@/features/ai/prompts/question-explanation";
import {
  GeminiExplanationError,
  generateGeminiExplanation,
  parseGeminiExplanation,
} from "@/features/ai/providers/gemini";
import type {
  ExplanationRequest,
  ExplanationResponse,
  QuestionExplanation,
  VerifiedQuestionContext,
} from "@/features/ai/types";
import type { StudentQuestion } from "@/features/questions/types";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAiUsage } from "@/features/ai/usage";
import type { Json } from "@/types/database";
import type { QuestionOption } from "@/types/domain";

const OPTION_KEYS = new Set<QuestionOption["key"]>(["A", "B", "C", "D", "E"]);

export class AiExplanationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
    /**
     * Present only when the refusal is a plan allowance rather than a fault, so
     * the route can answer with an upgrade path instead of a bare error.
     */
    readonly limit?: PlanLimitNotice,
  ) {
    super(message);
    this.name = "AiExplanationError";
  }
}

function optionKey(value: unknown): QuestionOption["key"] {
  if (!OPTION_KEYS.has(value as QuestionOption["key"])) throw new AiExplanationError("INVALID_DATA", 503, "This explanation is unavailable right now.");
  return value as QuestionOption["key"];
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function denialError(code: ReturnType<typeof explanationAccessDenial>): AiExplanationError {
  switch (code) {
    case "ANSWER_REQUIRED":
      return new AiExplanationError(code, 409, "Answer this question before asking MASTER AI to explain it.");
    case "ACTIVE_TIMED_SESSION":
      return new AiExplanationError(code, 403, "AI explanations are available after this timed session is completed.");
    case "ACTIVE_EXAM":
      return new AiExplanationError(code, 403, "AI explanations are available after this mock is submitted.");
    case "WHY_WRONG_NOT_APPLICABLE":
      return new AiExplanationError(code, 400, "Your answer is correct. Choose Explain better instead.");
    default:
      return new AiExplanationError("SESSION_NOT_REVIEWABLE", 409, "This session is not available for AI review.");
  }
}

interface LoadedContext {
  verified: VerifiedQuestionContext;
  status: string;
  practiceMode: "practice" | "timed" | null;
  isCorrect: boolean;
}

async function loadVerifiedContext(userId: string, request: ExplanationRequest): Promise<LoadedContext> {
  const db = createAdminClient();

  if (request.targetKind === "practice") {
    const { data: session, error: sessionError } = await db
      .from("practice_sessions")
      .select("id, mode, status")
      .eq("id", request.sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (sessionError) throw new AiExplanationError("LOOKUP_FAILED", 503, "This explanation is unavailable right now.");
    if (!session) throw new AiExplanationError("NOT_FOUND", 404, "Practice session not found.");

    const [{ data: question, error: questionError }, { data: answer, error: answerError }] = await Promise.all([
      db.from("practice_session_questions").select("id, student_snapshot, correct_option_key, explanation")
        .eq("id", request.questionId).eq("session_id", request.sessionId).maybeSingle(),
      db.from("practice_answers").select("selected_option_key, is_correct")
        .eq("session_id", request.sessionId).eq("session_question_id", request.questionId).eq("user_id", userId).maybeSingle(),
    ]);
    if (questionError || answerError) throw new AiExplanationError("LOOKUP_FAILED", 503, "This explanation is unavailable right now.");
    if (!question) throw new AiExplanationError("NOT_FOUND", 404, "Question not found.");

    const selectedOptionKey = answer ? optionKey(answer.selected_option_key) : null;
    const denial = explanationAccessDenial({
      targetKind: "practice",
      status: session.status,
      practiceMode: session.mode,
      hasAnswer: Boolean(selectedOptionKey),
      isCorrect: Boolean(answer?.is_correct),
      explanationType: request.explanationType,
    });
    if (denial) throw denialError(denial);

    return {
      status: session.status,
      practiceMode: session.mode,
      isCorrect: Boolean(answer?.is_correct),
      verified: {
        question: question.student_snapshot as unknown as StudentQuestion,
        correctOptionKey: optionKey(question.correct_option_key),
        selectedOptionKey: selectedOptionKey!,
        standardExplanation: question.explanation,
      },
    };
  }

  const { data: attempt, error: attemptError } = await db
    .from("exam_attempts")
    .select("id, status")
    .eq("id", request.sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (attemptError) throw new AiExplanationError("LOOKUP_FAILED", 503, "This explanation is unavailable right now.");
  if (!attempt) throw new AiExplanationError("NOT_FOUND", 404, "Mock attempt not found.");

  const [{ data: question, error: questionError }, { data: answer, error: answerError }] = await Promise.all([
    db.from("exam_attempt_questions").select("id, student_snapshot, correct_option_key, explanation")
      .eq("id", request.questionId).eq("attempt_id", request.sessionId).maybeSingle(),
    db.from("exam_attempt_answers").select("selected_option_key, is_correct")
      .eq("attempt_id", request.sessionId).eq("attempt_question_id", request.questionId).eq("user_id", userId).maybeSingle(),
  ]);
  if (questionError || answerError) throw new AiExplanationError("LOOKUP_FAILED", 503, "This explanation is unavailable right now.");
  if (!question) throw new AiExplanationError("NOT_FOUND", 404, "Question not found.");

  const selectedOptionKey = answer?.selected_option_key ? optionKey(answer.selected_option_key) : null;
  const isCorrect = Boolean(selectedOptionKey && selectedOptionKey === question.correct_option_key);
  const denial = explanationAccessDenial({
    targetKind: "exam",
    status: attempt.status,
    hasAnswer: Boolean(selectedOptionKey),
    isCorrect,
    explanationType: request.explanationType,
  });
  if (denial) throw denialError(denial);

  return {
    status: attempt.status,
    practiceMode: null,
    isCorrect,
    verified: {
      question: question.student_snapshot as unknown as StudentQuestion,
      correctOptionKey: optionKey(question.correct_option_key),
      selectedOptionKey: selectedOptionKey!,
      standardExplanation: question.explanation,
    },
  };
}

async function releaseClaim(cacheKey: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("release_ai_explanation_claim", { p_cache_key: cacheKey });
    if (error) console.error("[ai] claim release failed", { code: error.code });
  } catch {
    console.error("[ai] claim release failed");
  }
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

export async function explainQuestionForUser(userId: string, request: ExplanationRequest): Promise<ExplanationResponse> {
  if (!aiExplanationsEnabled()) {
    throw new AiExplanationError("AI_DISABLED", 503, "MASTER AI explanations are not available right now.");
  }

  const loaded = await loadVerifiedContext(userId, request);
  if (loaded.verified.question.assets.length > 0) {
    throw new AiExplanationError("VISUAL_QUESTION_UNSUPPORTED", 400, "AI explanation for image-based questions is not available yet.");
  }

  let prompt: string;
  try {
    prompt = buildQuestionExplanationPrompt(loaded.verified, request.explanationType);
  } catch (error) {
    if (error instanceof Error && error.message === "AI_QUESTION_TOO_LONG") {
      throw new AiExplanationError("QUESTION_TOO_LONG", 400, "This question is too long for an AI explanation right now.");
    }
    throw error;
  }

  const model = geminiModel();
  const cacheSelectedOption = request.explanationType === "why_wrong" ? loaded.verified.selectedOptionKey : null;
  const questionFingerprint = hash({
    question: loaded.verified.question,
    correctOptionKey: loaded.verified.correctOptionKey,
    standardExplanation: loaded.verified.standardExplanation,
  });
  const cacheKey = hash({
    questionFingerprint,
    explanationType: request.explanationType,
    selectedOptionKey: cacheSelectedOption,
    promptVersion: AI_PROMPT_VERSION,
    provider: AI_PROVIDER,
    model,
  });

  const db = createAdminClient();
  const { data: claimRows, error: claimError } = await db.rpc("claim_ai_explanation", {
    p_cache_key: cacheKey,
    p_question_fingerprint: questionFingerprint,
    p_explanation_type: request.explanationType,
    p_selected_option_key: cacheSelectedOption,
    p_prompt_version: AI_PROMPT_VERSION,
    p_provider: AI_PROVIDER,
    p_model: model,
    p_lease_seconds: 30,
    p_ttl_seconds: AI_CACHE_TTL_SECONDS,
  });
  if (claimError) throw new AiExplanationError("CLAIM_FAILED", 503, "MASTER AI is unavailable right now. Please try again shortly.");

  const claim = claimRows?.[0];
  if (!claim) throw new AiExplanationError("CLAIM_FAILED", 503, "MASTER AI is unavailable right now. Please try again shortly.");
  if (claim.outcome === "completed" && claim.content) {
    const explanation = parseGeminiExplanation(claim.content);
    await recordAiUsage({ userId, explanationType: request.explanationType, model, cacheHit: true, durationMs: 0, status: "ok" });
    return { explanation, cached: true, remainingToday: null };
  }
  if (claim.outcome === "in_progress") {
    throw new AiExplanationError("GENERATION_IN_PROGRESS", 409, "MASTER AI is already preparing this explanation. Try again in a moment.", 2);
  }

  const burst = await consumeRateLimit(RATE_LIMITS.aiExplanation, userId);
  if (!burst.allowed) {
    await releaseClaim(cacheKey);
    throw new AiExplanationError("RATE_LIMITED", 429, "Please wait a moment before requesting another AI explanation.", burst.retryAfterSeconds);
  }

  /*
   * The allowance is a plan entitlement, resolved on the server: three a day on
   * Free, twenty on Master. Only generation is counted — the cache hit above
   * returned before reaching here, so a reused explanation still costs nothing,
   * exactly as it did before plans existed.
   */
  const entitlement = await getEntitlement(userId);
  const dailyLimit = entitlement.limits.aiExplanationsPerDay;
  const { data: quotaRows, error: quotaError } = await db.rpc("consume_ai_daily_quota", {
    p_user_id: userId,
    p_feature: "question_explanation",
    p_limit: dailyLimit,
  });
  const quota = quotaRows?.[0];
  if (quotaError || !quota) {
    await releaseClaim(cacheKey);
    throw new AiExplanationError("QUOTA_UNAVAILABLE", 503, "MASTER AI is unavailable right now. Please try again shortly.");
  }
  if (!quota.allowed) {
    await releaseClaim(cacheKey);
    const notice = planLimitNotice({
      capability: "ai_explanation",
      tier: entitlement.tier,
      limit: dailyLimit,
      resetAt: quotaWindow("day").resetAt,
      windowKind: "day",
    });
    throw new AiExplanationError(
      notice.code,
      402,
      planLimitText(notice),
      secondsUntilUtcMidnight(),
      notice,
    );
  }

  const started = Date.now();
  try {
    const generated = await generateGeminiExplanation(prompt);
    const explanation: QuestionExplanation = request.explanationType === "explain_better"
      ? { ...generated.explanation, whyStudentAnswerIsWrong: null }
      : generated.explanation;
    const { error: settleError } = await db.rpc("settle_ai_explanation", {
      p_cache_key: cacheKey,
      p_content: asJson(explanation),
      p_ttl_seconds: AI_CACHE_TTL_SECONDS,
    });
    if (settleError) console.error("[ai] cache settlement failed", { code: settleError.code });

    await recordAiUsage({
      userId,
      explanationType: request.explanationType,
      model: generated.model,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      cacheHit: false,
      durationMs: Date.now() - started,
      status: "ok",
    });
    return { explanation, cached: false, remainingToday: quota.remaining };
  } catch (error) {
    await releaseClaim(cacheKey);
    const category = error instanceof GeminiExplanationError ? error.category : "internal";
    await recordAiUsage({
      userId,
      explanationType: request.explanationType,
      model,
      cacheHit: false,
      durationMs: Date.now() - started,
      status: "failed",
      errorCategory: category,
    });
    throw new AiExplanationError("GENERATION_FAILED", 503, "MASTER AI couldn’t generate an explanation right now. The standard explanation is still available.");
  }
}

export function parseExplanationRequest(value: unknown): ExplanationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiExplanationError("INVALID_REQUEST", 400, "Invalid explanation request.");
  const record = value as Record<string, unknown>;
  if (record.targetKind !== "practice" && record.targetKind !== "exam") throw new AiExplanationError("INVALID_REQUEST", 400, "Invalid result type.");
  if (typeof record.sessionId !== "string" || !record.sessionId) throw new AiExplanationError("INVALID_REQUEST", 400, "Session identifier is required.");
  if (typeof record.questionId !== "string" || !record.questionId) throw new AiExplanationError("INVALID_REQUEST", 400, "Question identifier is required.");
  if (record.explanationType !== "explain_better" && record.explanationType !== "why_wrong") {
    throw new AiExplanationError("INVALID_REQUEST", 400, "Invalid explanation type.");
  }
  return {
    targetKind: record.targetKind,
    sessionId: record.sessionId,
    questionId: record.questionId,
    explanationType: record.explanationType,
  };
}
