import Link from "next/link";
import { CalendarClock, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonClasses, radius, typography } from "@/components/ui/variants";
import type { Entitlement } from "@/features/billing/entitlements";
import { TIER_LIMITS } from "@/features/billing/plans";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function daysRemaining(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000));
}

/**
 * The state of the student's access, at the top of the billing page.
 *
 * Renew is a link to pricing rather than an in-place purchase button, because
 * the choice of duration is exactly the decision worth making again at renewal
 * time — a one-tap "renew" would quietly assume last time's answer.
 *
 * Both actions are real links: they navigate, so they open in a new tab, work
 * from the keyboard and survive right-click like any other link on the page.
 */
export function CurrentPlanCard({ entitlement }: { entitlement: Entitlement }) {
  const { isMaster, plan, expiresAt, limits } = entitlement;
  const remaining = isMaster && expiresAt ? daysRemaining(expiresAt) : 0;
  // A previous Master run that has since lapsed. Worth naming, because "you are
  // on Free" alone would look like the payment was lost.
  const lapsed = !isMaster && expiresAt !== null;

  return (
    <section
      aria-labelledby="current-plan"
      className={cn(
        "p-5 lg:p-6",
        radius.hero,
        isMaster ? "bg-slate-950 text-white" : "border border-slate-200 bg-white",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cn(typography.eyebrow, isMaster ? "text-brand-200" : "text-slate-500")}>
            Current plan
          </div>
          <h2
            id="current-plan"
            className={cn(
              "mt-1 font-serif text-xl font-semibold tracking-[-0.01em] sm:text-2xl",
              isMaster ? "text-white" : "text-slate-950",
            )}
          >
            {isMaster ? (plan?.name ?? "Master") : "Free"}
          </h2>
        </div>
        {isMaster ? (
          <Badge tone="success" dot className="bg-success-50">Active</Badge>
        ) : (
          <Badge tone="neutral" dot>Free tier</Badge>
        )}
      </div>

      {isMaster && expiresAt ? (
        <p className={cn("mt-4 flex items-start gap-2 text-[13px] leading-[1.55]", "text-white/85")}>
          <CalendarClock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-200" />
          <span>
            Master access until <strong className="font-bold text-white">{dateFormatter.format(new Date(expiresAt))}</strong>
            {" — "}
            {remaining === 0 ? "expiring today" : `${remaining} day${remaining === 1 ? "" : "s"} remaining`}.
          </span>
        </p>
      ) : (
        <p className={cn(typography.body, "mt-4")}>
          {lapsed ? (
            <>
              Your Master access ended on{" "}
              <strong className="font-semibold text-slate-950">
                {dateFormatter.format(new Date(expiresAt!))}
              </strong>
              . Your results, mistake bank and history are all still here — renewing picks up where you left off.
            </>
          ) : (
            <>
              You have {limits.practiceSessionsPerDay} practice sessions a day, {limits.mockAttempts} full mock a month
              and {limits.aiExplanationsPerDay} new AI explanations a day.
            </>
          )}
        </p>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-2.5">
        {[
          { label: "Practice / day", value: limits.practiceSessionsPerDay },
          { label: limits.mockAttemptWindow === "day" ? "Mocks / day" : "Mocks / month", value: limits.mockAttempts },
          { label: "AI / day", value: limits.aiExplanationsPerDay },
        ].map((item) => (
          <div
            key={item.label}
            className={cn("px-3 py-2.5", radius.control, isMaster ? "bg-white/10" : "bg-slate-50")}
          >
            <dt className={cn("text-[10.5px] font-medium", isMaster ? "text-white/60" : "text-slate-500")}>
              {item.label}
            </dt>
            <dd className={cn("mono-number mt-0.5 text-[17px] font-semibold", isMaster ? "text-white" : "text-slate-950")}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
        <Link
          href="/pricing"
          className={buttonClasses({
            variant: isMaster ? "secondary" : "primary",
            size: "lg",
            className: "w-full sm:w-auto sm:min-w-48",
          })}
        >
          {isMaster ? "Extend Master access" : lapsed ? "Renew Master access" : "Upgrade to Master"}
        </Link>
        {isMaster ? (
          <p className="flex items-center gap-2 text-[11.5px] text-white/60">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
            Nothing renews automatically. No card is stored.
          </p>
        ) : null}
      </div>

      {!isMaster ? (
        <p className={cn(typography.caption, "mt-3")}>
          Master raises your limits to {TIER_LIMITS.master.practiceSessionsPerDay} practice sessions,{" "}
          {TIER_LIMITS.master.mockAttempts} full mocks and {TIER_LIMITS.master.aiExplanationsPerDay} AI explanations a day.
        </p>
      ) : null}
    </section>
  );
}
