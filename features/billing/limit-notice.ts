import type { BillingTier } from "@/features/billing/plans";
import {
  aiExhausted,
  mockExhausted,
  PRACTICE_SESSION_IN_PROGRESS,
  practiceExhausted,
  resetLine,
} from "@/features/billing/copy";
import { PLANS_PATH, upgradeHref, type UpgradeSource } from "@/features/billing/upgrade";

/**
 * What a student is told when they reach a plan limit.
 *
 * "Quota exceeded" is an internal fact about a counter, not an explanation. A
 * student who has just been stopped needs four things: what ran out, when it
 * comes back, what upgrading would change, and a way to act on that. Every
 * message below carries all four, and the shape is shared so a route and the
 * component that renders its response cannot drift apart.
 *
 * Shared between server and client on purpose: the copy is written once (in
 * features/billing/copy.ts), the route returns it, and the browser only
 * presents it.
 */

export type LimitedCapability = "practice_session" | "mock_attempt" | "ai_explanation";

export const PLAN_LIMIT_CODE = "PLAN_LIMIT" as const;
/** The plan-selection page. Every upgrade link goes here, with a source. */
export const PRICING_HREF = PLANS_PATH;

export interface PlanLimitNotice {
  code: typeof PLAN_LIMIT_CODE;
  capability: LimitedCapability;
  tier: BillingTier;
  limit: number;
  /** ISO timestamp at which the allowance refills. */
  resetAt: string;
  /** "Resets at midnight (WAT)." — shown under the message, never a countdown. */
  resetLabel: string;
  /** One sentence naming what ran out. */
  message: string;
  /** What Master changes. Null when the student already has Master. */
  upgradeMessage: string | null;
  /** Straight to the plan cards, carrying which prompt sent the student. */
  upgradeHref: string;
  upgradeSource: UpgradeSource | null;
  /**
   * Set only when the refusal is "your session is already running". The
   * student has not lost anything, so the screen leads with Resume and keeps
   * Master beside it — never a dead end with an upgrade button as the only way
   * out. Absent on every other refusal.
   */
  resumeSessionId?: string;
}

const EXHAUSTED_SOURCE: Record<LimitedCapability, UpgradeSource> = {
  practice_session: "practice_exhausted",
  mock_attempt: "mock_exhausted",
  ai_explanation: "ai_exhausted",
};

export function planLimitNotice(input: {
  capability: LimitedCapability;
  tier: BillingTier;
  limit: number;
  resetAt: Date;
  windowKind: "day" | "month";
  /**
   * The practice session the student may go back to. Changes the message from
   * "you've used today's session" to "today's session is already in progress",
   * which is the truth and the difference between a refusal and a redirect.
   */
  resumeSessionId?: string | null;
}): PlanLimitNotice {
  const { capability, tier, limit, resetAt, windowKind, resumeSessionId } = input;
  const isFree = tier === "free";
  const resetLabel = resetLine(resetAt, windowKind);

  let message: string;
  let upgradeMessage: string | null = null;

  switch (capability) {
    case "ai_explanation": {
      if (isFree) {
        const copy = aiExhausted(limit);
        message = copy.message;
        upgradeMessage = copy.upgrade;
      } else {
        message = `You’ve used today’s ${limit} Master AI explanations.`;
      }
      break;
    }

    case "practice_session": {
      // A running session is not a used-up allowance: it is where the student's
      // allowance already is. Saying otherwise would send them to buy something
      // they do not need yet.
      const copy = resumeSessionId
        ? PRACTICE_SESSION_IN_PROGRESS
        : isFree
          ? practiceExhausted(limit)
          : { message: `You’ve started ${limit} practice sessions today.`, upgrade: "" };
      message = copy.message;
      upgradeMessage = isFree ? copy.upgrade : null;
      break;
    }

    default: {
      if (isFree) {
        const copy = windowKind === "month" ? mockExhausted(limit) : null;
        message = copy?.message ?? `You’ve used today’s ${limit} free mocks.`;
        upgradeMessage = copy?.upgrade ?? mockExhausted(limit).upgrade;
      } else {
        message = `You’ve started ${limit} full mocks today.`;
      }
      break;
    }
  }

  const upgradeSource = !upgradeMessage
    ? null
    : capability === "practice_session" && resumeSessionId
      ? "practice_session_in_progress"
      : EXHAUSTED_SOURCE[capability];

  return {
    code: PLAN_LIMIT_CODE,
    capability,
    tier,
    limit,
    resetAt: resetAt.toISOString(),
    resetLabel,
    message,
    upgradeMessage,
    upgradeHref: upgradeSource ? upgradeHref(upgradeSource) : PLANS_PATH,
    upgradeSource,
    ...(resumeSessionId ? { resumeSessionId } : {}),
  };
}

/** The single string shown when only one line fits — a toast, an inline alert. */
export function planLimitText(notice: PlanLimitNotice): string {
  return notice.upgradeMessage
    ? `${notice.message} ${notice.upgradeMessage}`
    : `${notice.message} ${notice.resetLabel}`;
}

/** Narrows an arbitrary API error body to a limit notice, for the browser. */
export function asPlanLimitNotice(value: unknown): PlanLimitNotice | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const limit = record.limit as Record<string, unknown> | undefined;
  if (record.code !== PLAN_LIMIT_CODE || !limit || typeof limit !== "object") return null;
  if (typeof limit.message !== "string" || typeof limit.capability !== "string") return null;
  return limit as unknown as PlanLimitNotice;
}
