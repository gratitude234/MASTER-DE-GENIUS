import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { typography } from "@/components/ui/variants";

interface LatestMockCardProps {
  score: number;
  maximum: number;
  /** True when the score is JAMB-scaled rather than a raw correct count. */
  scaled: boolean;
  /** Already-formatted completion date. */
  date: string;
  href: string;
  /** Change from the previous mock. `null` means there is no previous one. */
  delta: number | null;
}

/**
 * The last completed mock. Rendered only when one exists — see
 * `LatestMockEmptyCard` for the alternative, so the dashboard never shows a
 * zero that looks like a result.
 */
export function LatestMockCard({ score, maximum, scaled, date, href, delta }: LatestMockCardProps) {
  const improved = delta !== null && delta > 0;
  const declined = delta !== null && delta < 0;

  return (
    <section className="flex min-h-full flex-col rounded-2xl border border-slate-200 bg-white p-[18px]">
      <h2 className={typography.h2}>Latest mock</h2>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <div className="mono-number text-[30px] font-semibold leading-none tracking-[-0.02em] text-slate-950">{score}</div>
        <div className="mono-number text-[13px] font-semibold text-slate-500">/ {maximum}</div>
      </div>
      <p className="mt-1 text-[11.5px] font-medium text-slate-500">
        {scaled ? "Estimated JAMB score" : "Correct answers"}
      </p>
      {/* Direction is carried by the word and the arrow, not by the colour alone. */}
      {delta === null ? null : (
        <p
          className={cn(
            "mt-2 text-[11.5px] font-bold",
            improved ? "text-success-700" : declined ? "text-danger-700" : "text-slate-500",
          )}
        >
          {improved ? `↑ Up ${delta} from` : declined ? `↓ Down ${Math.abs(delta)} from` : "Level with"} your previous mock
        </p>
      )}
      <p className="mt-1 text-[11px] text-slate-500">{date}</p>
      <Link
        href={href}
        className="mt-auto flex min-h-11 items-center gap-1.5 self-start rounded pt-3 text-xs font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        View result <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}

/** The honest alternative to a 0/400 that a student has not earned. */
export function LatestMockEmptyCard() {
  return (
    <section className="flex min-h-full flex-col rounded-2xl border border-slate-200 bg-white p-[18px]">
      <h2 className={typography.h2}>Latest mock</h2>
      <p className="mt-2.5 text-[13px] leading-[1.6] text-slate-600">
        You have not finished a mock yet. A full mock runs under JAMB timing and gives you a scaled score out of 400.
      </p>
      <Link
        href="/mock"
        className="mt-auto flex min-h-11 items-center gap-1.5 self-start rounded pt-3 text-xs font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        Explore mock exams <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}
