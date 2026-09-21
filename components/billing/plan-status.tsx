"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Crown, Sparkles } from "lucide-react";

import { UpgradeLink } from "@/components/billing/upgrade-link";
import type { PlanBadge } from "@/features/billing/usage-types";
import { cn } from "@/lib/utils";

const untilFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

/**
 * The persistent plan indicator, implemented once for the whole student shell.
 *
 * Free: "Upgrade to Master" is one tap from every major page — the desktop rail
 * on large screens, a slim strip above the page on phones. Master: no sales
 * prompt at all, only the plan and the date access runs to.
 *
 * The tier comes from the server-resolved entitlement in the student layout;
 * this component draws it and decides nothing.
 */
export function PlanRailCard({ plan }: { plan: PlanBadge | null }) {
  if (!plan) return null;

  if (plan.tier === "master") {
    return (
      <Link
        href="/billing"
        className="mb-2.5 flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.05] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      >
        <Crown aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-200" />
        <span className="min-w-0">
          <span className="block text-xs font-bold">Master plan</span>
          {plan.masterUntil ? (
            <span className="block text-[11px] leading-4 text-white/55">Access until {untilFormatter.format(new Date(plan.masterUntil))}</span>
          ) : null}
        </span>
      </Link>
    );
  }

  return (
    <div className="mb-2.5 rounded-xl border border-brand-300/30 bg-brand-500/15 p-3">
      <div className="flex items-center gap-2 text-xs font-bold">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-brand-200" /> Free plan
      </div>
      <p className="mt-0.5 text-[11px] leading-4 text-white/60">More practice, mocks and MASTER AI with Master.</p>
      <UpgradeLink
        source="nav"
        className="mt-2.5 flex min-h-[38px] w-full items-center justify-center rounded-lg bg-white text-[12.5px] font-bold text-slate-950 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 motion-reduce:transition-none"
      />
    </div>
  );
}

/** Routes where the strip would compete with the task or repeat the page itself. */
function hideStrip(pathname: string) {
  return pathname.startsWith("/practice/session/")
    || pathname.startsWith("/pricing")
    || pathname.startsWith("/billing");
}

/**
 * The phone version: one line above the page, below nothing, covering nothing.
 * The tab bar has no sixth slot and must not lose one, so the upgrade path lives
 * here instead of three screens deep under "Me".
 */
export function PlanStrip({ plan }: { plan: PlanBadge | null }) {
  const pathname = usePathname();
  if (!plan || plan.tier !== "free" || hideStrip(pathname)) return null;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 py-1.5 pl-3 pr-1.5 lg:hidden">
      <p className="min-w-0 text-[12px] leading-4 text-slate-700">
        <span className="font-bold text-slate-950">Free plan</span>
        <span className="hidden min-[380px]:inline"> · limited daily practice</span>
      </p>
      <UpgradeLink
        source="nav_mobile"
        className={cn(
          "inline-flex min-h-11 shrink-0 items-center rounded-lg bg-slate-950 px-3.5 text-[12px] font-bold text-white",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
        )}
      />
    </div>
  );
}
