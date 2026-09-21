import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

export interface ProgressMetric {
  key: string;
  label: string;
  /** "31/80", "20", "6/20". Monospaced so two rows line up. */
  value: string;
  /** Optional qualifier, e.g. "Estimated JAMB score". */
  note?: string;
  /** Deep link for this row, when one is meaningful. */
  href?: string;
}

/**
 * One card for everything the student has measured: the latest mock, the
 * mistakes waiting, and how each subject is going.
 *
 * It replaces three separate full-width cards — Latest Mock, Mistakes Ready and
 * Subject Performance — which between them filled a phone screen with numbers
 * before the student reached anything they could act on. Same data, one card,
 * one heading, one way out to the full progress page.
 *
 * A metric with no data is not rendered. A dashboard that shows "0 / 400" to a
 * student who has never sat a mock is reporting a score they did not get.
 */
export function ProgressSummaryCard({ metrics }: { metrics: ProgressMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <section aria-labelledby="progress-summary-heading" className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="progress-summary-heading" className={cn(typography.eyebrow, "text-slate-500")}>Your progress</h2>

      <dl className="mt-2.5 divide-y divide-slate-100">
        {metrics.map((metric) => (
          <div key={metric.key} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <dt className="min-w-0 text-[12.5px] font-semibold text-slate-700">
              {metric.href ? (
                <Link
                  href={metric.href}
                  className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                >
                  {metric.label}
                </Link>
              ) : (
                metric.label
              )}
              {metric.note ? <span className="mt-px block text-[11px] font-medium text-slate-500">{metric.note}</span> : null}
            </dt>
            <dd className="mono-number shrink-0 text-[14px] font-semibold text-slate-950">{metric.value}</dd>
          </div>
        ))}
      </dl>

      <Link
        href="/progress"
        className="mt-1 flex min-h-11 items-center gap-1.5 self-start rounded pt-2 text-xs font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        View progress <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}
