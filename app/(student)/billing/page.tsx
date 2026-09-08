import { CurrentPlanCard } from "@/components/billing/current-plan-card";
import { PaymentHistory } from "@/components/billing/payment-history";
import { typography } from "@/components/ui/variants";
import { getBillingSummary } from "@/features/billing/entitlements";
import { requireOnboardedUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Billing",
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const { user } = await requireOnboardedUser();
  // One pass: entitlement and history together, scoped to this user server-side.
  const { entitlement, payments } = await getBillingSummary(user.id);

  return (
    <div className="screen-enter mx-auto max-w-[720px] space-y-4">
      <div>
        <div className={cn(typography.eyebrow, "text-brand-500")}>Account</div>
        <h1 className={cn("mt-1.5", typography.h1)}>Billing</h1>
        <p className="mt-1 text-[13px] leading-[1.5] text-slate-600">
          Your plan, your access dates and every payment you have made.
        </p>
      </div>

      <CurrentPlanCard entitlement={entitlement} />

      <section aria-labelledby="payment-history" className="space-y-2.5">
        <h2 id="payment-history" className={typography.h2}>Payment history</h2>
        <PaymentHistory payments={payments} />
      </section>
    </div>
  );
}
