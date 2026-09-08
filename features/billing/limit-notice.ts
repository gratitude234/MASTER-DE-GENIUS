import type { BillingTier } from "@/features/billing/plans";
import { TIER_LIMITS } from "@/features/billing/plans";

/**
 * What a student is told when they reach a plan limit.
 *
 * "Quota exceeded" is an internal fact about a counter, not an explanation. A
 * student who has just been stopped needs four things: what ran out, when it
 * comes back, what upgrading would change, and a way to act on that. Every
 * message below carries all four, and the shape is shared so a route and the
 * component that renders its response cannot drift apart.
 *
 * Shared between server and client on purpose: the copy is written once, the
 * route returns it, and the browser only presents it.
 */

export type LimitedCapability = "practice_session" | "mock_attempt" | "ai_explanation";

export const PLAN_LIMIT_CODE = "PLAN_LIMIT" as const;
export const PRICING_HREF = "/pricing" as const;

export interface PlanLimitNotice {
  code: typeof PLAN_LIMIT_CODE;
  capability: LimitedCapability;
  tier: BillingTier;
  limit: number;
  /** ISO timestamp at which the allowance refills. */
  resetAt: string;
  /** One sentence naming what ran out and when it returns. */
  message: string;
  /** What Master changes. Null when the student already has Master. */
  upgradeMessage: string | null;
  upgradeHref: typeof PRICING_HREF;
}

/** "at midnight UTC" / "on 1 October" — how the reset is described to a student. */
function resetPhrase(resetAt: Date, kind: "day" | "month"): string {
  if (kind === "day") return "at midnight UTC";
  return `on ${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(resetAt)}`;
}

/*
 * The AI upgrade line — the message a free student is most likely to see.
 *
 * The specified copy ended "…complete mistake review and advanced revision
 * tools", but this release does not restrict mistake review or revision at all:
 * a Free student already has both in full. Selling them as Master features
 * would be a promise the product does not keep, and the first thing a paying
 * student would notice is that nothing changed.
 *
 * So the sentence keeps its shape and its real differentiator — the twenty
 * daily generations — and names the two limits Master genuinely raises. Restore
 * the original wording in the same change that actually gates mistake review.
 */
const AI_UPGRADE_MESSAGE =
  `Upgrade to Master for up to ${TIER_LIMITS.master.aiExplanationsPerDay} personalized explanations daily, ` +
  `${TIER_LIMITS.master.practiceSessionsPerDay} practice sessions and ` +
  `${TIER_LIMITS.master.mockAttempts} full mocks every day.`;

export function planLimitNotice(input: {
  capability: LimitedCapability;
  tier: BillingTier;
  limit: number;
  resetAt: Date;
  windowKind: "day" | "month";
}): PlanLimitNotice {
  const { capability, tier, limit, resetAt, windowKind } = input;
  const when = resetPhrase(resetAt, windowKind);
  const isFree = tier === "free";

  let message: string;
  let upgradeMessage: string | null;

  switch (capability) {
    case "ai_explanation":
      message = isFree
        ? `You’ve used today’s ${limit} free AI explanations.`
        : `You’ve used today’s ${limit} Master AI explanations. Your allowance resets ${when}.`;
      upgradeMessage = isFree ? AI_UPGRADE_MESSAGE : null;
      break;

    case "practice_session":
      message = isFree
        ? `You’ve started your ${limit} practice sessions for today. Your allowance resets ${when}.`
        : `You’ve started ${limit} practice sessions today — your Master allowance resets ${when}.`;
      upgradeMessage = isFree
        ? `Upgrade to Master for ${TIER_LIMITS.master.practiceSessionsPerDay} practice sessions a day, ${TIER_LIMITS.master.mockAttempts} full mocks a day and ${TIER_LIMITS.master.aiExplanationsPerDay} AI explanations daily.`
        : null;
      break;

    default:
      message = isFree
        ? `You’ve used your free full mock for this month. Your next free mock unlocks ${when}.`
        : `You’ve started ${limit} full mocks today — your Master allowance resets ${when}.`;
      upgradeMessage = isFree
        ? `Upgrade to Master for ${TIER_LIMITS.master.mockAttempts} full mocks every day, ${TIER_LIMITS.master.practiceSessionsPerDay} practice sessions daily and complete mistake review.`
        : null;
      break;
  }

  // The free AI message carries the reset inside the upgrade sentence instead,
  // so the two never read as a duplicated "resets at midnight".
  if (capability === "ai_explanation" && isFree) {
    message = `${message} Your free allowance resets ${when}.`;
  }

  return {
    code: PLAN_LIMIT_CODE,
    capability,
    tier,
    limit,
    resetAt: resetAt.toISOString(),
    message,
    upgradeMessage,
    upgradeHref: PRICING_HREF,
  };
}

/** The single string shown when only one line fits — a toast, an inline alert. */
export function planLimitText(notice: PlanLimitNotice): string {
  return notice.upgradeMessage ? `${notice.message} ${notice.upgradeMessage}` : notice.message;
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
