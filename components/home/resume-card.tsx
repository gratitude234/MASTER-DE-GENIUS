import Link from "next/link";
import { Clock3, PlayCircle } from "lucide-react";

import { buttonClasses, typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

export interface ResumeItem {
  /** Where "Resume" goes. */
  href: string;
  /** "Exam in progress" / "Practice in progress". */
  eyebrow: string;
  title: string;
  /** "3/180 answered" and friends. Each rendered as its own chip. */
  facts: string[];
  actionLabel: string;
}

/**
 * Unfinished work, at the top of the dashboard.
 *
 * A student who walked away mid-paper does not need a recommendation, a plan
 * summary or a tutoring offer — they need the way back in. This is the first
 * thing under the header when it renders at all, above every suggestion the
 * product might make.
 *
 * It renders **one** item. `resumeItems` decides which, so there can never be
 * two cards competing to be resumed, and a mock and a practice session can
 * never both claim the top of the page.
 */
export function ResumeCard({ item }: { item: ResumeItem }) {
  return (
    <section aria-labelledby="resume-heading" className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3.5 sm:px-[18px] sm:py-4">
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-3.5">
        <div aria-hidden="true" className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl bg-brand-500 text-white">
          <PlayCircle className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn(typography.eyebrow, "text-brand-500")}>{item.eyebrow}</div>
          <h2 id="resume-heading" className="mt-0.5 text-[14.5px] font-bold text-slate-950">{item.title}</h2>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-600">
            {item.facts.map((fact, index) => (
              <span key={fact} className="inline-flex items-center gap-1">
                {index > 0 ? <span aria-hidden="true" className="mr-1">·</span> : null}
                {/* The time chip is the only one that earns an icon. */}
                {fact.endsWith("left") ? <Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                {fact}
              </span>
            ))}
          </div>
        </div>
        {/* Unfinished work is the most urgent thing on the page: full control size, not a text link. */}
        <Link href={item.href} className={buttonClasses({ variant: "dark", size: "md", className: "w-full shrink-0 sm:w-auto" })}>
          {item.actionLabel}
        </Link>
      </div>
    </section>
  );
}
