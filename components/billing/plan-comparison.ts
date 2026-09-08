import { TIER_LIMITS } from "@/features/billing/plans";

/**
 * The Free/Master comparison, written once.
 *
 * Every row is honest about what this release actually enforces. Where a
 * restriction is documented but not yet implemented, the row says what a
 * student gets today rather than what a later release will restrict — a pricing
 * table that promises a limitation the code does not apply is as misleading as
 * one that promises a feature it does not ship.
 */

export interface ComparisonRow {
  capability: string;
  free: string;
  master: string;
  /** Marked when Free is genuinely capped rather than merely smaller. */
  gated: boolean;
}

export const PLAN_COMPARISON: readonly ComparisonRow[] = [
  {
    capability: "Practice questions",
    free: `${TIER_LIMITS.free.practiceSessionsPerDay} sessions per day`,
    master: `${TIER_LIMITS.master.practiceSessionsPerDay} sessions per day`,
    gated: true,
  },
  {
    capability: "Full mock attempts",
    free: `${TIER_LIMITS.free.mockAttempts} per month`,
    master: `${TIER_LIMITS.master.mockAttempts} per day`,
    gated: true,
  },
  {
    capability: "New AI explanations",
    free: `${TIER_LIMITS.free.aiExplanationsPerDay} per day`,
    master: `${TIER_LIMITS.master.aiExplanationsPerDay} per day`,
    gated: true,
  },
  // The four rows below are the promise that free never becomes a paywall on
  // the student's own results. They are deliberately identical in both columns.
  { capability: "Your scores and correct answers", free: "Included", master: "Included", gated: false },
  { capability: "Standard written explanations", free: "Included", master: "Included", gated: false },
  { capability: "Answer review after completion", free: "Included", master: "Included", gated: false },
  { capability: "Result history", free: "Included", master: "Included", gated: false },
  { capability: "Mistake bank and revision", free: "Included", master: "Included", gated: false },
  { capability: "Offline and timed sessions", free: "Included", master: "Included", gated: false },
] as const;

/** The short benefit list on the Master cards. */
export const MASTER_BENEFITS: readonly string[] = [
  `${TIER_LIMITS.master.practiceSessionsPerDay} practice sessions every day`,
  `${TIER_LIMITS.master.mockAttempts} full mock attempts every day`,
  `${TIER_LIMITS.master.aiExplanationsPerDay} new AI explanations every day`,
  "Everything in Free, with no daily ceiling to plan around",
] as const;

export const FREE_BENEFITS: readonly string[] = [
  `${TIER_LIMITS.free.practiceSessionsPerDay} practice sessions a day`,
  `${TIER_LIMITS.free.mockAttempts} full mock a month`,
  `${TIER_LIMITS.free.aiExplanationsPerDay} new AI explanations a day`,
  "Your scores, correct answers and written explanations",
] as const;
