import { Sparkles } from "lucide-react";

import { UpgradeLink } from "@/components/billing/upgrade-link";
import { buttonClasses, radius } from "@/components/ui/variants";
import type { UpgradeSource } from "@/features/billing/upgrade";
import { cn } from "@/lib/utils";

/**
 * The shared conversion moment: one free unit left, or none.
 *
 * Two weights, one component. `subtle` is a single line with a text link — the
 * student is still working and should not be interrupted. `prominent` is a
 * panel with a real button — they have reached the edge of what Free includes
 * and the next step is the decision.
 *
 * Never a modal, never an alert: nothing has failed, and the student's work,
 * results and answers are all still in front of them. `role="status"` makes it
 * announced without seizing focus.
 */
export function AllowanceNotice({
  message,
  upgrade,
  source,
  detail,
  emphasis = "prominent",
  className,
}: {
  message: string;
  /** The sentence that says what Master changes. */
  upgrade?: string | null;
  source: UpgradeSource;
  /** A quiet second line — when it resets, what stays available. */
  detail?: string | null;
  emphasis?: "subtle" | "prominent";
  className?: string;
}) {
  if (emphasis === "subtle") {
    // One line. When there is an upgrade sentence it becomes the link text
    // itself, so the link still reads as a complete action out of context.
    return (
      <p
        role="status"
        className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-[1.55] text-slate-700", className)}
      >
        <span>{message}</span>
        <UpgradeLink
          source={source}
          className="inline-flex min-h-11 items-center rounded font-bold text-brand-500 underline-offset-2 hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {upgrade ?? undefined}
        </UpgradeLink>
        {detail ? <span className="basis-full text-[11.5px] text-slate-500">{detail}</span> : null}
      </p>
    );
  }

  return (
    <section role="status" className={cn("border border-brand-200 bg-brand-50 p-4 sm:p-[18px]", radius.card, className)}>
      <div className="flex items-start gap-3">
        <div aria-hidden="true" className={cn("grid h-9 w-9 shrink-0 place-items-center bg-brand-500 text-white", radius.control)}>
          <Sparkles className="h-[17px] w-[17px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-[1.5] text-slate-950">{message}</p>
          {upgrade ? <p className="mt-1 text-[12.5px] leading-[1.55] text-slate-700">{upgrade}</p> : null}
          {detail ? <p className="mt-1 text-[11.5px] leading-[1.5] text-slate-500">{detail}</p> : null}
          <UpgradeLink
            source={source}
            className={buttonClasses({ variant: "dark", size: "md", className: "mt-3.5 w-full sm:w-auto sm:min-w-44" })}
          />
        </div>
      </div>
    </section>
  );
}
