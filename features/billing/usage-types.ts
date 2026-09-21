import type { BillingTier, PracticeAllowanceUnit } from "@/features/billing/plans";

/**
 * The one shape every screen reads a student's allowance from.
 *
 * Produced only on the server (features/billing/usage.ts) from the ledgers the
 * routes enforce against. Components display it; none of them computes a
 * quota. A count is null when it could not be read — the screen then shows the
 * allowance without claiming how much of it is left.
 */
export interface UsageMeter {
  limit: number;
  used: number | null;
  remaining: number | null;
  /** ISO instant of the next refill. */
  resetAt: string;
  window: "day" | "month";
}

export interface PracticeUsage extends UsageMeter {
  /** Free counts questions; Master counts sessions. */
  unit: PracticeAllowanceUnit;
  /** Questions already held in an unfinished session (question unit only). */
  waiting: number | null;
  /** The largest new session that may be started now (question unit only). */
  available: number | null;
}

export interface UsageSummary {
  tier: BillingTier;
  isMaster: boolean;
  /** Master access end, for "access until"; null on Free. */
  masterUntil: string | null;
  practice: PracticeUsage;
  mocks: UsageMeter;
  aiExplanations: UsageMeter;
}

/** The server's answer to "how many practice questions do I have?" (Free). */
export interface PracticeQuestionAllowance {
  limit: number;
  /** Answered today, plus today's questions left unanswered in a finished session. */
  used: number;
  /** Held questions still answerable in an unfinished session. */
  waiting: number;
  /** How many more questions can be answered today. */
  remaining: number;
  /** The largest new session that may be started now. */
  available: number;
}

/** The subset the persistent shell needs: enough to choose a CTA or a badge. */
export interface PlanBadge {
  tier: BillingTier;
  masterUntil: string | null;
}
