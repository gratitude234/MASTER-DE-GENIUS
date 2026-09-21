import Link from "next/link";
import { Crown } from "lucide-react";

import { UpgradeLink } from "@/components/billing/upgrade-link";
import { BrandMark } from "@/components/brand/brand-mark";
import { Badge } from "@/components/ui/badge";
import { buttonClasses, typography } from "@/components/ui/variants";
import type { BillingTier } from "@/features/billing/plans";
import { cn } from "@/lib/utils";

const untilFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });

interface HomeHeaderProps {
  name: string;
  /** e.g. "JAMB 2027 Preparation". */
  examLabel: string;
  /**
   * The student's plan, from the server-resolved entitlement.
   *
   * Free gets the dashboard's *one* upgrade button, here at the top. There is
   * deliberately no second banner under it: the compact Free plan card further
   * down carries the counts and its own button, and this page used to open with
   * a strip, a banner and a full-width plan panel stacked three deep before the
   * student saw anything they could study.
   *
   * Master gets its status and the date access runs to — never a sales prompt.
   */
  tier?: BillingTier;
  masterUntil?: string | null;
  /**
   * Percentage shown in the readiness chip. Omit it entirely — there is no
   * agreed readiness formula yet, and a placeholder number would be read as a
   * real assessment of whether the student is ready to sit the exam.
   */
  readiness?: number;
  /**
   * Days until the exam. Omit it unless the app has a real exam date; the
   * student preference stores a year only, which cannot produce a day count.
   */
  daysLeft?: number;
}

export function HomeHeader({ name, examLabel, readiness, daysLeft, tier, masterUntil = null }: HomeHeaderProps) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "DG";

  return (
    <header>
      {/* Mobile only: on desktop the rail already carries the mark. */}
      <div className="mb-5 flex items-center justify-between lg:hidden">
        <BrandMark sublabel={false} className="[&>div:first-child]:h-7 [&>div:first-child]:w-7 [&>div:first-child]:text-[13px]" />
        <div
          aria-hidden="true"
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-slate-950 text-xs font-bold text-white"
        >
          {initials}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className={typography.h1}>Welcome back, {name}.</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] text-slate-600">{examLabel}</span>
            {tier === "free" ? <Badge tone="neutral">Free plan</Badge> : null}
            {daysLeft === undefined ? null : (
              <Badge tone="brand">{daysLeft} days to go</Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {readiness === undefined ? null : (
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold text-slate-500">Readiness</span>
              <span className="mono-number text-xl font-semibold text-slate-950">{readiness}%</span>
            </div>
          )}

          {/* The dashboard's single top-level plan control. Exactly one. */}
          {tier === "free" ? (
            <UpgradeLink source="dashboard" className={buttonClasses({ variant: "primary", size: "md" })} />
          ) : tier === "master" ? (
            <Link
              href="/billing"
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
              )}
            >
              <Crown aria-hidden="true" className="h-3.5 w-3.5 text-brand-500" />
              Master{masterUntil ? " · until " + untilFormatter.format(new Date(masterUntil)) : ""}
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
