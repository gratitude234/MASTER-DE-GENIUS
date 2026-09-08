import "server-only";

import { GoogleGenAI } from "@google/genai";

import { geminiApiKey, geminiModel, geminiTimeoutMs } from "@/features/ai/config";
import { EXPLANATION_SYSTEM_INSTRUCTION } from "@/features/ai/prompts/question-explanation";
import type { QuestionExplanation } from "@/features/ai/types";

const EXPLANATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "One sentence stating the verified answer plainly." },
    reasoning: { type: "string", description: "A concise step-by-step explanation in clear secondary-school English." },
    whyStudentAnswerIsWrong: {
      anyOf: [
        { type: "string", description: "Why the selected wrong option is incorrect." },
        { type: "null" },
      ],
    },
    memoryTip: {
      anyOf: [
        { type: "string", description: "A short accurate memory aid, or null when none is useful." },
        { type: "null" },
      ],
    },
  },
  required: ["summary", "reasoning", "whyStudentAnswerIsWrong", "memoryTip"],
} as const;

export class GeminiExplanationError extends Error {
  constructor(
    readonly category: "not_configured" | "timeout" | "provider" | "invalid_response",
    /**
     * A short, sanitized reason for the server log.
     *
     * Without this the category alone reaches the operator — "provider" says
     * nothing about whether the model name is wrong, the key is rejected or the
     * quota is spent, and the three need completely different fixes.
     */
    readonly detail?: string,
  ) {
    super(`Gemini explanation failed: ${category}`);
    this.name = "GeminiExplanationError";
  }
}

/**
 * Reduces a provider failure to something safe to log.
 *
 * Provider errors name the model and the reason, which is exactly what an
 * operator needs — but the same object can carry the request that produced it.
 * Only the status and a bounded, key-redacted message survive, so a question,
 * an answer key or a credential can never reach a log line.
 */
function describeProviderError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";

  const record = error as unknown as Record<string, unknown>;
  const status = record.status ?? record.statusCode ?? record.code;
  const message = String(error.message ?? "")
    // Anything long and token-shaped is treated as a credential.
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted-key]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  return [error.name, status == null ? null : `status=${status}`, message].filter(Boolean).join(" ");
}

function cleanText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new GeminiExplanationError("invalid_response");
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum) throw new GeminiExplanationError("invalid_response");
  return cleaned;
}

export function parseGeminiExplanation(value: unknown): QuestionExplanation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GeminiExplanationError("invalid_response");
  }
  const record = value as Record<string, unknown>;
  return {
    summary: cleanText(record.summary, 500)!,
    reasoning: cleanText(record.reasoning, 2_000)!,
    whyStudentAnswerIsWrong: cleanText(record.whyStudentAnswerIsWrong, 1_200),
    memoryTip: cleanText(record.memoryTip, 500),
  };
}

export interface GeminiGenerationResult {
  explanation: QuestionExplanation;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export async function generateGeminiExplanation(prompt: string): Promise<GeminiGenerationResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new GeminiExplanationError("not_configured");

  const model = geminiModel();
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.interactions.create({
      model,
      input: prompt,
      system_instruction: EXPLANATION_SYSTEM_INSTRUCTION,
      store: false,
      generation_config: { max_output_tokens: 500, thinking_level: "low", seed: 17 },
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: EXPLANATION_SCHEMA,
      },
    }, {
      timeout_ms: geminiTimeoutMs(),
      retries: { strategy: "attempt-count-backoff", maxRetries: 1, retryConnectionErrors: true },
    });

    const text = response.output_text;
    if (!text) throw new GeminiExplanationError("invalid_response");
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new GeminiExplanationError("invalid_response");
    }

    return {
      explanation: parseGeminiExplanation(decoded),
      model,
      inputTokens: response.usage?.total_input_tokens ?? null,
      outputTokens: response.usage?.total_output_tokens ?? null,
    };
  } catch (error) {
    if (error instanceof GeminiExplanationError) throw error;
    const detail = describeProviderError(error);
    if (error instanceof Error && /timeout|abort/i.test(error.message)) {
      throw new GeminiExplanationError("timeout", detail);
    }
    // The model name is the single most common cause of a fast rejection, and
    // it is configuration rather than content, so it is safe to name.
    throw new GeminiExplanationError("provider", `model=${model} ${detail}`.slice(0, 240));
  }
}
