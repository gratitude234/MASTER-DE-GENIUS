export const TARGET_SCORE_MIN = 180;
export const TARGET_SCORE_MAX = 400;

/**
 * Mirrors the bounds `completeOnboardingAction` enforces, so the inline message
 * and the server's verdict can never disagree. The server stays the authority —
 * this only spares the student a round trip to be told about a typo.
 *
 * Takes the raw input string rather than a number, because an empty or
 * part-typed field is exactly the case worth catching.
 */
export function validateTargetScore(value: string): string | undefined {
  if (value.trim() === "") return "Enter a target score.";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < TARGET_SCORE_MIN || parsed > TARGET_SCORE_MAX) {
    return `Your target score must be a whole number between ${TARGET_SCORE_MIN} and ${TARGET_SCORE_MAX}.`;
  }
  return undefined;
}
