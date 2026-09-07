import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { typography } from "@/components/ui/variants";

export interface WeakArea {
  subject: string;
  topic: string;
  accuracy: number;
  correct: number;
  total: number;
}

/**
 * The weak topics from the latest attempt.
 *
 * Rows are informational: the single strongest recommendation already has its
 * own call to action at the top of the dashboard, and per-row links would have
 * to invent query parameters that Practice Setup does not read yet. The card
 * links to the attempt's own breakdown instead.
 */
export function WeakAreasCard({ areas, resultHref }: { areas: WeakArea[]; resultHref: string }) {
  return (
    <section className="flex min-h-full flex-col rounded-2xl border border-slate-200 bg-white p-[18px]">
      <h2 className={typography.h2}>Weak areas</h2>
      <p className="mt-0.5 text-[11px] font-medium text-slate-500">Scored under 70% in your latest attempt</p>
      <div className="mt-2.5 divide-y divide-slate-100 border-t border-slate-100">
        {areas.map((area) => (
          <div className="flex items-center gap-3 py-2.5" key={`${area.subject}-${area.topic}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-slate-950">{area.topic}</div>
              <div className="mt-px text-[10.5px] font-medium text-slate-500">{area.subject}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="mono-number text-xs font-bold text-danger-600">{area.accuracy}%</div>
              <div className="mono-number mt-px text-[10.5px] font-medium text-slate-500">{area.correct}/{area.total}</div>
            </div>
          </div>
        ))}
      </div>
      <Link
        href={resultHref}
        className="mt-auto flex min-h-11 items-center gap-1.5 self-start rounded pt-3 text-xs font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        Explore topics &amp; weak areas <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}
