import { ShieldCheck } from "lucide-react";

import { PricingPlans } from "@/components/billing/pricing-plans";
import { radius, typography } from "@/components/ui/variants";
import { getEntitlement } from "@/features/billing/entitlements";
import { requireOnboardedUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Plans and pricing",
};

// Entitlement and expiry must be current the moment this page is opened —
// especially straight after a payment settles.
export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export default async function PricingPage() {
  const { user } = await requireOnboardedUser();
  // Resolved on the server. The cards below display it; they never decide it.
  const entitlement = await getEntitlement(user.id);

  return (
    <div className="screen-enter mx-auto max-w-[1000px] space-y-4">
      <div>
        <div className={cn(typography.eyebrow, "text-brand-500")}>Plans</div>
        <h1 className={cn("mt-1.5", typography.h1)}>Study without a daily ceiling</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-[1.5] text-slate-600">
          Every plan keeps your scores, your correct answers and your written explanations. Master raises
          how much you can practise, mock and generate each day.
        </p>
      </div>

      <PricingPlans
        currentTier={entitlement.tier}
        currentPlanSlug={entitlement.plan?.slug ?? null}
        expiryLabel={
          entitlement.isMaster && entitlement.expiresAt
            ? dateFormatter.format(new Date(entitlement.expiresAt))
            : null
        }
      />

      <section className={cn("border border-slate-200 bg-white p-5", radius.card)}>
        <h2 className={cn("flex items-center gap-2", typography.h2)}>
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-brand-500" /> How payment works
        </h2>
        <ul className="mt-3 space-y-2">
          {[
            "Payment is handled by Paystack. MASTER@DE'GENIUS never sees or stores your card details.",
            "Every plan is a one-time payment for a fixed number of days. Nothing renews automatically and nothing is charged again.",
            "Buying while Master is still active adds the new days on top of the days you already have — you lose nothing by renewing early.",
            "Your access activates once the payment is confirmed with Paystack, usually within a few seconds.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-[12.5px] leading-[1.6] text-slate-600">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
