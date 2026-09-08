import type { ExplanationTargetKind, ExplanationType } from "@/features/ai/types";

export interface ExplanationAccessContext {
  targetKind: ExplanationTargetKind;
  status: string;
  practiceMode?: "practice" | "timed" | null;
  hasAnswer: boolean;
  isCorrect: boolean;
  explanationType: ExplanationType;
}

export type ExplanationAccessDenial =
  | "ANSWER_REQUIRED"
  | "ACTIVE_TIMED_SESSION"
  | "ACTIVE_EXAM"
  | "SESSION_NOT_REVIEWABLE"
  | "WHY_WRONG_NOT_APPLICABLE";

/**
 * This policy is enforced on the server after ownership and stored-answer
 * lookup. Hiding a button is never treated as an examination security control.
 */
export function explanationAccessDenial(context: ExplanationAccessContext): ExplanationAccessDenial | null {
  if (!context.hasAnswer) return "ANSWER_REQUIRED";

  if (context.targetKind === "practice") {
    if (context.practiceMode === "timed" && context.status !== "completed") return "ACTIVE_TIMED_SESSION";
    if (context.practiceMode === "practice" && context.status !== "in_progress" && context.status !== "completed") {
      return "SESSION_NOT_REVIEWABLE";
    }
  } else if (context.status !== "submitted") {
    return "ACTIVE_EXAM";
  }

  if (context.explanationType === "why_wrong" && context.isCorrect) return "WHY_WRONG_NOT_APPLICABLE";
  return null;
}

