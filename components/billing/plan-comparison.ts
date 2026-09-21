import {
  aiAllowanceLabel,
  countNoun,
  mockAllowanceLabel,
  practiceAllowanceLabel,
} from "@/features/billing/copy";
import { TIER_LIMITS } from "@/features/billing/plans";

/**
 * The Free/Master comparison, written once.
 *
 * Every row is honest about what this release actually enforces, and every
 * number is read from the plan configuration — never typed here. Where a
 * restriction is not implemented, the row says what a student gets today.
 */

export interface ComparisonRow {
  capability: string;
  free: string;
  master: string;
  /** Marked when Free is genuinely capped rather than merely smaller. */
  gated: boolean;
}

const free = TIER_LIMITS.free;
const master = TIER_LIMITS.master;

export const PLAN_COMPARISON: readonly ComparisonRow[] = [
  {
    capability: "Practice",
    free: practiceAllowanceLabel(free.practice),
    master: practiceAllowanceLabel(master.practice),
    gated: true,
  },
  {
    capability: "Full mock attempts",
    free: mockAllowanceLabel(free),
    master: mockAllowanceLabel(master),
    gated: true,
  },
  {
    capability: "New MASTER AI explanations",
    free: aiAllowanceLabel(free.aiExplanationsPerDay),
    master: aiAllowanceLabel(master.aiExplanationsPerDay),
    gated: true,
  },
  // The rows below are the promise that free never becomes a paywall on the
  // student's own results. They are deliberately identical in both columns.
  { capability: "Your scores and correct answers", free: "Included", master: "Included", gated: false },
  { capability: "Standard written explanations", free: "Included", master: "Included", gated: false },
  { capability: "Answer review after completion", free: "Included", master: "Included", gated: false },
  { capability: "Result history", free: "Included", master: "Included", gated: false },
  { capability: "Mistake bank", free: "Included", master: "Included", gated: false },
  { capability: "Offline and timed sessions", free: "Included", master: "Included", gated: false },
] as const;

/** The short benefit list on the Master cards. */
export const MASTER_BENEFITS: readonly string[] = [
  `${practiceAllowanceLabel(master.practice)}, each as long as you like`,
  `${countNoun(master.mockAttempts, "full mock attempt")} every ${master.mockAttemptWindow}`,
  `${countNoun(master.aiExplanationsPerDay, "new MASTER AI explanation")} every day`,
  "Everything in Free, with no daily ceiling to plan around",
] as const;

export const FREE_BENEFITS: readonly string[] = [
  practiceAllowanceLabel(free.practice),
  mockAllowanceLabel(free),
  aiAllowanceLabel(free.aiExplanationsPerDay),
  "Your scores, correct answers, written explanations and mistake bank",
] as const;
