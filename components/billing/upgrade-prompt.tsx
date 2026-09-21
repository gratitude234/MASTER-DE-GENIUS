import { AllowanceNotice } from "@/components/billing/allowance-notice";
import { radius, typography } from "@/components/ui/variants";
import type { PlanLimitNotice } from "@/features/billing/limit-notice";
import { cn } from "@/lib/utils";

/**
 * What a student sees the moment a plan limit stops them.
 *
 * Deliberately not an error band. Reaching a limit is a normal thing that
 * happens to somebody who has been studying hard, and "quota exceeded" in red
 * reads like they broke something. This states what ran out, what Master would
 * change, when it comes back, and gives one obvious way to act — a single
 * "Upgrade to Master" straight to the plan cards.
 *
 * On Master there is nothing to sell, so the notice only says when the
 * allowance returns.
 */
export function UpgradePrompt({ notice, className }: { notice: PlanLimitNotice; className?: string }) {
  if (notice.upgradeMessage && notice.upgradeSource) {
    return (
      <AllowanceNotice
        className={className}
        message={notice.message}
        upgrade={notice.upgradeMessage}
        source={notice.upgradeSource}
        detail={notice.resetLabel ?? null}
      />
    );
  }

  return (
    <section role="status" className={cn("border border-slate-200 bg-white p-4 sm:p-[18px]", radius.card, className)}>
      <p className="text-[13px] font-bold leading-[1.5] text-slate-950">{notice.message}</p>
      {notice.resetLabel ? <p className={cn(typography.body, "mt-1 text-slate-600")}>{notice.resetLabel}</p> : null}
    </section>
  );
}
