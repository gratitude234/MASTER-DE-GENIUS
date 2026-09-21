import { BrainCircuit, ClipboardCheck, GraduationCap } from "lucide-react";

import { UpgradeLink } from "@/components/billing/upgrade-link";
import { buttonClasses, radius, typography } from "@/components/ui/variants";
import { countNoun, remainingLine, resetPhrase } from "@/features/billing/copy";
import { formatNaira, purchasablePlans } from "@/features/billing/plans";
import type { UsageMeter, UsageSummary } from "@/features/billing/usage-types";
import { cn } from "@/lib/utils";

/**
 * The Free plan, at a glance, near the top of Home.
 *
 * Every count comes from the server's usage summary — the same ledgers the
 * routes enforce against — and is only displayed here. A count the server could
 * not read is shown as the allowance alone ("Up to 4 a day"), never guessed.
 *
 * The price line reads the billing catalogue, so it can never disagree with
 * what checkout charges.
 */
export function FreePlanCard({ usage }: { usage: UsageSummary }) {
  const cheapest = [...purchasablePlans()].sort((a, b) => a.priceKobo - b.priceKobo)[0];
  // Follows the configured unit, so a configuration rollback to sessions still reads truthfully.
  const practiceNoun = usage.practice.unit === "question" ? "question" : "session";

  const rows = [
    {
      key: "practice",
      label: "Practice",
      icon: GraduationCap,
      meter: usage.practice as UsageMeter,
      value: (m: UsageMeter) => remainingLine(m.remaining ?? 0, m.limit, practiceNoun, "day"),
      fallback: `Up to ${countNoun(usage.practice.limit, practiceNoun)} a day`,
      waiting: usage.practice.unit === "question" ? usage.practice.waiting : null,
    },
    {
      key: "mocks",
      label: "Mock Exams",
      icon: ClipboardCheck,
      meter: usage.mocks,
      value: (m: UsageMeter) => remainingLine(m.remaining ?? 0, m.limit, null, m.window),
      fallback: `Up to ${countNoun(usage.mocks.limit, "mock")} a ${usage.mocks.window}`,
      waiting: null,
    },
    {
      key: "ai",
      label: "MASTER AI",
      icon: BrainCircuit,
      meter: usage.aiExplanations,
      value: (m: UsageMeter) => remainingLine(m.remaining ?? 0, m.limit, "explanation", "day"),
      fallback: `Up to ${countNoun(usage.aiExplanations.limit, "explanation")} a day`,
      waiting: null,
    },
  ];

  return (
    <section aria-labelledby="free-plan-heading" className={cn("border border-slate-200 bg-white p-4 sm:p-5", radius.card)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn(typography.eyebrow, "text-slate-500")}>Your plan</div>
          <h2 id="free-plan-heading" className="mt-0.5 text-[15px] font-bold text-slate-950">Free Plan</h2>
        </div>
        <p className="text-[11.5px] leading-5 text-slate-500">
          Daily allowances reset {resetPhrase(usage.practice.resetAt, "day")}.
          {usage.mocks.window === "month" ? ` Mocks reset ${resetPhrase(usage.mocks.resetAt, "month")}.` : ""}
        </p>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        {rows.map(({ key, label, icon: Icon, meter, value, fallback, waiting }) => {
          const empty = meter.remaining === 0;
          return (
            <div key={key} className={cn("px-3 py-2.5", radius.control, empty ? "bg-warning-50" : "bg-slate-50")}>
              <dt className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600">
                <Icon aria-hidden="true" className="h-3.5 w-3.5" /> {label}
              </dt>
              <dd className={cn("mt-1 text-[13px] font-bold leading-snug", empty ? "text-warning-900" : "text-slate-950")}>
                {meter.remaining === null ? fallback : value(meter)}
                {waiting ? (
                  <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
                    {countNoun(waiting, "question")} waiting in an unfinished session
                  </span>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <UpgradeLink
          source="dashboard"
          className={buttonClasses({ variant: "primary", size: "lg", className: "w-full sm:w-auto sm:min-w-48" })}
        />
        {cheapest?.durationDays ? (
          <p className="text-center text-[11.5px] text-slate-500 sm:text-left">
            Master from {formatNaira(cheapest.priceKobo)} for {cheapest.durationDays} days. Nothing renews automatically.
          </p>
        ) : null}
      </div>
    </section>
  );
}
