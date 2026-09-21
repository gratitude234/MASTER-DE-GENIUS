import Link from "next/link";
import { BrainCircuit, ClipboardCheck, GraduationCap } from "lucide-react";

import { UpgradeLink } from "@/components/billing/upgrade-link";
import { buttonClasses, radius, typography } from "@/components/ui/variants";
import {
  countNoun,
  PRACTICE_SESSION_IN_PROGRESS_SHORT,
  PRACTICE_SESSION_USED_SHORT,
  practiceAvailableLine,
  remainingLine,
  resetPhrase,
} from "@/features/billing/copy";
import type { UsageMeter, UsageSummary } from "@/features/billing/usage-types";
import { cn } from "@/lib/utils";

/**
 * The Free plan, compactly, below the day's actual work.
 *
 * This card used to be the loudest thing on the dashboard — a full-width panel
 * with its own price line, sitting above the student's unfinished exam. It is
 * now three short rows and one button, and it sits after Practice, Mock and
 * Progress: a student's own session outranks an advertisement for the plan.
 *
 * Every count comes from the server's usage summary — the same reservations the
 * routes enforce against — and is only displayed here. A count the server could
 * not read falls back to the allowance itself ("Up to 1 session a day"), never
 * to a guess.
 *
 * Practice reads as a state, not a fraction: "1 session available today",
 * "Session in progress", "Today's session used". A student who is mid-session
 * has lost nothing, and the card must not imply they have.
 */
export function FreePlanCard({ usage }: { usage: UsageSummary }) {
  const practice = usage.practice;
  const active = practice.activeSession;

  const practiceValue = practice.remaining === null
    ? `Up to ${countNoun(practice.limit, "session")} a day`
    : practice.remaining > 0
      ? practiceAvailableLine(practice.remaining)
      : active
        ? PRACTICE_SESSION_IN_PROGRESS_SHORT
        : PRACTICE_SESSION_USED_SHORT;

  const rows = [
    {
      key: "practice",
      label: "Practice",
      icon: GraduationCap,
      value: practiceValue,
      // Only a finished day is an empty state. A running session is not.
      empty: practice.remaining === 0 && !active,
    },
    {
      key: "mocks",
      label: "Mock",
      icon: ClipboardCheck,
      value: usage.mocks.remaining === null
        ? `Up to ${countNoun(usage.mocks.limit, "mock")} a ${usage.mocks.window}`
        : remainingLine(usage.mocks.remaining, usage.mocks.limit, null, usage.mocks.window),
      empty: usage.mocks.remaining === 0,
    },
    {
      key: "ai",
      label: "MASTER AI",
      icon: BrainCircuit,
      value: meterValue(usage.aiExplanations, "explanation"),
      empty: usage.aiExplanations.remaining === 0,
    },
  ];

  return (
    <section aria-labelledby="free-plan-heading" className={cn("border border-slate-200 bg-white p-4", radius.card)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="free-plan-heading" className={cn(typography.eyebrow, "text-slate-500")}>Free plan</h2>
        <p className="text-[11px] leading-4 text-slate-500">Resets {resetPhrase(practice.resetAt, "day")}</p>
      </div>

      <dl className="mt-2.5 space-y-1.5 sm:grid sm:grid-cols-3 sm:gap-2 sm:space-y-0">
        {rows.map(({ key, label, icon: Icon, value, empty }) => (
          <div
            key={key}
            className={cn(
              "flex items-center justify-between gap-3 px-3 py-2 sm:block",
              radius.control,
              empty ? "bg-warning-50" : "bg-slate-50",
            )}
          >
            <dt className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-slate-600">
              <Icon aria-hidden="true" className="h-3.5 w-3.5" /> {label}
            </dt>
            <dd className={cn(
              "text-right text-[12.5px] font-bold leading-snug sm:mt-1 sm:text-left",
              empty ? "text-warning-900" : "text-slate-950",
            )}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <UpgradeLink
          source="dashboard"
          className={buttonClasses({ variant: "primary", size: "md", className: "w-full sm:w-auto sm:min-w-44" })}
        />
        {/* Resuming never uses another session, so the card says so where it matters. */}
        {active ? (
          <Link
            href={`/practice/session/${active.id}`}
            className={buttonClasses({ variant: "secondary", size: "md", className: "w-full sm:w-auto" })}
          >
            Resume session
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function meterValue(meter: UsageMeter, noun: string): string {
  return meter.remaining === null
    ? `Up to ${countNoun(meter.limit, noun)} a ${meter.window}`
    : remainingLine(meter.remaining, meter.limit, null, meter.window);
}
