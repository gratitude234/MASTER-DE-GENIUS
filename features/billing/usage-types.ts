import type { BillingTier } from "@/features/billing/plans";

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

/**
 * Practice, which is counted in **new sessions per day**, account-wide.
 *
 * `activeSession` is what makes "used" readable to a student: a Free student
 * whose one session is still running has not lost anything, and the screen must
 * say "in progress · Resume" rather than "used". It is null when no practice
 * session is unfinished, and null (not absent) when it could not be read.
 */
export interface PracticeUsage extends UsageMeter {
  /** The largest paper this plan may build, from the plan configuration. */
  maxQuestionsPerSession: number;
  activeSession: ActivePracticeSession | null;
}

/** An unfinished practice session, whichever exam it belongs to. */
export interface ActivePracticeSession {
  id: string;
  subjectName: string;
  answeredCount: number;
  questionCount: number;
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

/** The subset the persistent shell needs: enough to choose a CTA or a badge. */
export interface PlanBadge {
  tier: BillingTier;
  masterUntil: string | null;
}
