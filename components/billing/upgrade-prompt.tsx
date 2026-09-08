import Link from "next/link";
import { Sparkles } from "lucide-react";

import { buttonClasses, radius, typography } from "@/components/ui/variants";
import type { PlanLimitNotice } from "@/features/billing/limit-notice";
import { cn } from "@/lib/utils";

/**
 * What a student sees the moment a plan limit stops them.
 *
 * Deliberately not an error band. Reaching a limit is a normal thing that
 * happens to somebody who has been studying hard, and "quota exceeded" in red
 * reads like they broke something. This states what ran out, when it comes
 * back, what Master would change, and gives one obvious way to act.
 *
 * `role="status"` rather than `alert`: it is worth announcing, but it is not an
 * interruption — nothing the student did has failed or been lost.
 */
export function UpgradePrompt({ notice, className }: { notice: PlanLimitNotice; className?: string }) {
  return (
    <section
      role="status"
      className={cn("border border-brand-200 bg-brand-50 p-4 sm:p-[18px]", radius.card, className)}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={cn("grid h-9 w-9 shrink-0 place-items-center bg-brand-500 text-white", radius.control)}
        >
          <Sparkles className="h-[17px] w-[17px]" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-[1.5] text-slate-950">{notice.message}</p>

          {notice.upgradeMessage ? (
            <p className={cn(typography.body, "mt-1.5 text-slate-700")}>{notice.upgradeMessage}</p>
          ) : null}

          {notice.upgradeMessage ? (
            <Link
              href={notice.upgradeHref}
              className={buttonClasses({ variant: "dark", size: "md", className: "mt-3.5 w-full sm:w-auto sm:min-w-44" })}
            >
              See Master plans
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
