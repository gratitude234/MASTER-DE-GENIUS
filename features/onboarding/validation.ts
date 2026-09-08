import type { OnboardingExamCode } from "@/features/onboarding/types";

export const EXAM_ONBOARDING_RULES = {
  jamb: {
    targetMin: 180, targetMax: 400, targetDefault: 280, targetStep: 5,
    minSubjects: 4, maxSubjects: 4,
  },
  waec: {
    targetMin: 1, targetMax: 100, targetDefault: 70, targetStep: 1,
    minSubjects: 1, maxSubjects: 9,
  },
} as const;

export const TARGET_SCORE_MIN = EXAM_ONBOARDING_RULES.jamb.targetMin;
export const TARGET_SCORE_MAX = EXAM_ONBOARDING_RULES.jamb.targetMax;

export function isOnboardingExamCode(value: string): value is OnboardingExamCode {
  return value === "jamb" || value === "waec";
}

/**
 * Mirrors the bounds `completeOnboardingAction` enforces, so the inline message
 * and the server's verdict can never disagree. The server stays the authority —
 * this only spares the student a round trip to be told about a typo.
 *
 * Takes the raw input string rather than a number, because an empty or
 * part-typed field is exactly the case worth catching.
 */
export function validateTargetScore(value: string, examCode: OnboardingExamCode = "jamb"): string | undefined {
  const rules = EXAM_ONBOARDING_RULES[examCode];
  if (value.trim() === "") return "Enter a target score.";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < rules.targetMin || parsed > rules.targetMax) {
    const label = examCode === "waec" ? "percentage goal" : "target score";
    return `Your ${label} must be a whole number between ${rules.targetMin} and ${rules.targetMax}.`;
  }
  return undefined;
}
