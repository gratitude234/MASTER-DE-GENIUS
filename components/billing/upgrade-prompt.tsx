import Link from "next/link";

import { AllowanceNotice } from "@/components/billing/allowance-notice";
import { UpgradeLink } from "@/components/billing/upgrade-link";
import { buttonClasses, radius, typography } from "@/components/ui/variants";
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
  /*
   * "Today's session is already in progress" is not a wall — the student's own
   * work is one tap away. Resume is the primary action and Master is the quiet
   * alternative beside it, which is the opposite emphasis from every other
   * limit, and deliberately so: selling an upgrade to somebody who only needs
   * to press Continue is the wrong answer to their situation.
   */
  if (notice.resumeSessionId) {
    return (
      <section role="status" className={cn("border border-brand-200 bg-brand-50 p-4", radius.card, className)}>
        <p className="text-[13px] font-bold leading-[1.5] text-slate-950">{notice.message}</p>
        <p className="mt-1 text-[12.5px] leading-[1.55] text-slate-700">
          Continue it where you left off — resuming never uses another session.
        </p>
        <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link
            href={`/practice/session/${notice.resumeSessionId}`}
            className={buttonClasses({ variant: "dark", size: "md", className: "w-full sm:w-auto sm:min-w-44" })}
          >
            Resume session
          </Link>
          {notice.upgradeMessage && notice.upgradeSource ? (
            <UpgradeLink
              source={notice.upgradeSource}
              className="inline-flex min-h-11 items-center justify-center rounded font-bold text-[12.5px] text-brand-500 underline-offset-2 hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            />
          ) : null}
        </div>
      </section>
    );
  }

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
