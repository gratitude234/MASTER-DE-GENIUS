"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";

import { CheckoutButton } from "@/components/billing/checkout-button";
import { FREE_BENEFITS, MASTER_BENEFITS, PLAN_COMPARISON } from "@/components/billing/plan-comparison";
import { Badge } from "@/components/ui/badge";
import { radius, typography } from "@/components/ui/variants";
import {
  BILLING_PLANS,
  formatNaira,
  pricePerDayLabel,
  type BillingPlan,
  type BillingTier,
} from "@/features/billing/plans";
import { cn } from "@/lib/utils";

interface PricingPlansProps {
  currentTier: BillingTier;
  /** The active Master plan slug, when one is running. */
  currentPlanSlug: string | null;
  /** Formatted expiry date, or null on Free. */
  expiryLabel: string | null;
}

function BenefitList({ items, inverse = false }: { items: readonly string[]; inverse?: boolean }) {
  return (
    <ul className="mt-4 space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-[12.5px] leading-[1.55]">
          <Check
            aria-hidden="true"
            className={cn("mt-0.5 h-4 w-4 shrink-0", inverse ? "text-brand-200" : "text-success-600")}
          />
          <span className={inverse ? "text-white/85" : "text-slate-600"}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The pricing cards.
 *
 * `busy` is lifted here rather than kept per card so that starting a checkout
 * on one plan visibly disables the others: two Paystack pages opened a second
 * apart is a confusing way to find out you have two pending payments.
 *
 * Nothing on this page decides access. The current-plan indicator is read from
 * the server-resolved entitlement, and every button posts a slug the server
 * re-prices — editing this component's state in devtools changes what is drawn
 * and nothing else.
 */
export function PricingPlans({ currentTier, currentPlanSlug, expiryLabel }: PricingPlansProps) {
  const [busy, setBusy] = useState(false);

  const free = BILLING_PLANS.find((plan) => plan.tier === "free")!;
  const paid = BILLING_PLANS.filter((plan) => plan.tier === "master");
  const isMaster = currentTier === "master";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Free is a real plan with a real card, not an absence of one. */}
        <section
          className={cn(
            "border bg-white p-5",
            radius.hero,
            !isMaster ? "border-brand-300 ring-1 ring-brand-100" : "border-slate-200",
          )}
          aria-labelledby="plan-free"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="plan-free" className={typography.h3}>{free.name}</h2>
              <p className={cn(typography.caption, "mt-1")}>{free.tagline}</p>
            </div>
            {!isMaster ? <Badge tone="brand" dot>Current plan</Badge> : null}
          </div>

          <p className="mono-number mt-4 text-[32px] font-semibold leading-none text-slate-950">
            {formatNaira(free.priceKobo)}
            <span className="ml-1.5 text-[12.5px] font-medium text-slate-500">forever</span>
          </p>

          <BenefitList items={FREE_BENEFITS} />

          <p className={cn(typography.caption, "mt-5 border-t border-slate-100 pt-4")}>
            Free never hides your score, your correct answers or your written explanations.
          </p>
        </section>

        {/* The Master summary sits opposite Free so the comparison reads across. */}
        <section
          className={cn("bg-slate-950 p-5 text-white", radius.hero)}
          aria-labelledby="plan-master-summary"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={cn(typography.eyebrow, "text-brand-200")}>Master</div>
              <h2 id="plan-master-summary" className="mt-1 font-serif text-base font-semibold sm:text-[17px]">
                Prepare without a daily ceiling
              </h2>
            </div>
            <div aria-hidden="true" className={cn("grid h-9 w-9 shrink-0 place-items-center bg-white/10", radius.control)}>
              <Sparkles className="h-[17px] w-[17px]" />
            </div>
          </div>

          <BenefitList items={MASTER_BENEFITS} inverse />

          {isMaster && expiryLabel ? (
            <p className="mt-5 border-t border-white/10 pt-4 text-[12.5px] text-white/75">
              Your Master access runs until <strong className="font-bold text-white">{expiryLabel}</strong>.
            </p>
          ) : (
            <p className="mt-5 border-t border-white/10 pt-4 text-[12.5px] text-white/75">
              One payment, fixed access. Nothing renews automatically and no card is stored.
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {paid.map((plan) => (
          <PlanCard
            key={plan.slug}
            plan={plan}
            isCurrent={currentPlanSlug === plan.slug}
            isMaster={isMaster}
            busy={busy}
            onBusyChange={setBusy}
          />
        ))}
      </div>

      <section aria-labelledby="plan-comparison" className={cn("border border-slate-200 bg-white p-5", radius.card)}>
        <h2 id="plan-comparison" className={typography.h2}>What each plan includes</h2>

        {/*
          A wide table on a 360px screen has to scroll somewhere. It scrolls
          inside this container rather than pushing the whole page sideways.
        */}
        <div className="-mx-5 mt-3 overflow-x-auto px-5">
          <table className="w-full min-w-[420px] border-collapse text-left">
            <caption className="sr-only">Free and Master plan comparison</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className={cn(typography.eyebrow, "py-2.5 text-slate-500")}>Capability</th>
                <th scope="col" className={cn(typography.eyebrow, "py-2.5 text-slate-500")}>Free</th>
                <th scope="col" className={cn(typography.eyebrow, "py-2.5 text-brand-600")}>Master</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_COMPARISON.map((row) => (
                <tr key={row.capability} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="py-3 pr-4 text-[12.5px] font-semibold text-slate-950">
                    {row.capability}
                  </th>
                  <td className="py-3 pr-4 text-[12.5px] text-slate-600">{row.free}</td>
                  <td className="py-3 text-[12.5px] font-semibold text-slate-950">{row.master}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  isCurrent,
  isMaster,
  busy,
  onBusyChange,
}: {
  plan: BillingPlan;
  isCurrent: boolean;
  isMaster: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const perDay = pricePerDayLabel(plan);
  const headingId = `plan-${plan.slug}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "relative flex flex-col border bg-white p-5",
        radius.hero,
        plan.isPopular ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200",
      )}
    >
      {plan.isPopular ? (
        <Badge tone="brand" className="absolute -top-2.5 left-5 shadow-sm">Most Popular</Badge>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className={typography.h3}>{plan.name}</h3>
        {isCurrent ? <Badge tone="success" dot>Active</Badge> : null}
      </div>

      <p className={cn(typography.caption, "mt-1")}>{plan.tagline}</p>

      <p className="mono-number mt-4 text-[32px] font-semibold leading-none text-slate-950">
        {formatNaira(plan.priceKobo)}
      </p>
      <p className={cn(typography.caption, "mt-1.5")}>
        {plan.durationDays} days of Master{perDay ? ` · about ${perDay}` : ""}
      </p>

      <div className="mt-auto">
        <CheckoutButton
          plan={plan}
          busy={busy}
          onBusyChange={onBusyChange}
          variant={plan.isPopular ? "dark" : "primary"}
          // "Master Monthly" is 30 days of access bought once. It is never
          // described as a subscription, because nothing renews on its own.
          label={isMaster ? `Extend by ${plan.durationDays} days` : `Get ${plan.durationDays} days`}
        />
        <p className={cn(typography.caption, "mt-2.5 text-center")}>
          One-time payment. Does not renew automatically.
        </p>
      </div>
    </section>
  );
}
