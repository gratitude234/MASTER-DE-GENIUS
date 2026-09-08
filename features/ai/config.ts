import "server-only";

function positiveInteger(raw: string | undefined, fallback: number, maximum: number): number {
  const value = Number(raw?.trim());
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

export const AI_PROMPT_VERSION = "question-explanation-v1";
export const AI_PROVIDER = "gemini";
export const AI_CACHE_TTL_SECONDS = 48 * 60 * 60;

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
}

export function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || "";
}

/*
 * The daily generation allowance is no longer an environment variable.
 *
 * It is now a plan entitlement — three a day on Free, twenty on Master — and it
 * lives with the other plan limits in features/billing/plans.ts. A second
 * source of truth in the environment could silently contradict what the pricing
 * page promises a paying student.
 */

export function geminiTimeoutMs(): number {
  return positiveInteger(process.env.GEMINI_TIMEOUT_MS, 12_000, 60_000);
}

export function aiExplanationsEnabled(): boolean {
  const flag = process.env.AI_EXPLANATIONS_ENABLED?.trim().toLowerCase();
  return (flag === "true" || flag === "1") && Boolean(geminiApiKey());
}

