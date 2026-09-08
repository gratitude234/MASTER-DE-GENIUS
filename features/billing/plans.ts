/**
 * The single source of truth for what MASTER@DE'GENIUS sells and what each
 * plan is allowed to do.
 *
 * This module is deliberately isolated from the server: the pricing page, the
 * billing page and the upgrade prompts all need the same names, prices and
 * limits the checkout endpoint charges against, and duplicating them into
 * components is how a "₦1,500" card ends up billing ₦150.
 *
 * Nothing here may be overridden by a request. The browser submits a plan slug
 * and nothing else; every amount, currency and duration below is resolved on
 * the server from this table and re-checked against `billing_plans` in
 * PostgreSQL before any entitlement is granted.
 */

export type BillingTier = "free" | "master";

export interface BillingPlan {
  readonly slug: string;
  readonly name: string;
  readonly tier: BillingTier;
  /** Kobo. Paystack is charged in the smallest currency unit. */
  readonly priceKobo: number;
  readonly currency: "NGN";
  /** Days of Master access this purchase grants. Null for the free tier. */
  readonly durationDays: number | null;
  /** Exactly one paid plan carries this, and the database enforces it too. */
  readonly isPopular: boolean;
  readonly tagline: string;
  readonly displayOrder: number;
}

export const BILLING_CURRENCY = "NGN" as const;

export const BILLING_PLANS: readonly BillingPlan[] = [
  {
    slug: "free",
    name: "Free",
    tier: "free",
    priceKobo: 0,
    currency: BILLING_CURRENCY,
    durationDays: null,
    isPopular: false,
    tagline: "Everything you need to start preparing seriously.",
    displayOrder: 1,
  },
  {
    slug: "master_30",
    name: "Master Monthly",
    tier: "master",
    priceKobo: 150_000,
    currency: BILLING_CURRENCY,
    durationDays: 30,
    isPopular: false,
    tagline: "A full month of unrestricted practice.",
    displayOrder: 2,
  },
  {
    slug: "master_90",
    name: "Master Exam Pass",
    tier: "master",
    priceKobo: 350_000,
    currency: BILLING_CURRENCY,
    durationDays: 90,
    isPopular: true,
    tagline: "Covers a complete exam run-up at the lowest cost per day.",
    displayOrder: 3,
  },
  {
    slug: "master_180",
    name: "Master Season Pass",
    tier: "master",
    priceKobo: 550_000,
    currency: BILLING_CURRENCY,
    durationDays: 180,
    isPopular: false,
    tagline: "Two full terms of preparation in one purchase.",
    displayOrder: 4,
  },
] as const;

export const FREE_PLAN: BillingPlan = BILLING_PLANS[0];

/** Any catalogue entry, including the free tier. */
export function findPlan(slug: unknown): BillingPlan | null {
  if (typeof slug !== "string") return null;
  return BILLING_PLANS.find((plan) => plan.slug === slug) ?? null;
}

/**
 * The only lookup a checkout request may use.
 *
 * `free` is a real plan but it is not purchasable, and an unknown slug must
 * never fall through to a default price. Both return null so the caller has to
 * reject rather than guess.
 */
export function findPurchasablePlan(slug: unknown): BillingPlan | null {
  const plan = findPlan(slug);
  if (!plan || plan.tier === "free" || plan.priceKobo <= 0 || !plan.durationDays) return null;
  return plan;
}

export function purchasablePlans(): readonly BillingPlan[] {
  return BILLING_PLANS.filter((plan) => plan.tier !== "free");
}

/**
 * Product limits, per tier.
 *
 * These are the entitlement quotas the product sells. They are not the provider
 * abuse limiter in lib/rate-limit.ts — that one exists to stop a runaway script
 * exhausting the question provider's quota for everybody, and it applies to
 * paying and free students alike.
 */
export interface TierLimits {
  /** Practice sessions a student may create. */
  readonly practiceSessionsPerDay: number;
  /** Full mock attempts. Free is monthly; Master is daily. */
  readonly mockAttempts: number;
  readonly mockAttemptWindow: "day" | "month";
  /** Newly generated AI explanations. Cache hits never count. */
  readonly aiExplanationsPerDay: number;
}

export const TIER_LIMITS: Record<BillingTier, TierLimits> = {
  free: {
    practiceSessionsPerDay: 20,
    mockAttempts: 1,
    mockAttemptWindow: "month",
    aiExplanationsPerDay: 3,
  },
  master: {
    practiceSessionsPerDay: 200,
    mockAttempts: 3,
    mockAttemptWindow: "day",
    aiExplanationsPerDay: 20,
  },
};

export function limitsForTier(tier: BillingTier): TierLimits {
  return TIER_LIMITS[tier];
}

const nairaFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

/** ₦1,500 — kobo are never shown to a student, and never rounded up. */
export function formatNaira(kobo: number): string {
  return nairaFormatter.format(Math.floor(kobo / 100));
}

/** "₦50/day" style value framing for the pricing cards. */
export function pricePerDayLabel(plan: BillingPlan): string | null {
  if (!plan.durationDays || plan.priceKobo <= 0) return null;
  return `${nairaFormatter.format(Math.round(plan.priceKobo / plan.durationDays / 100))} per day`;
}
