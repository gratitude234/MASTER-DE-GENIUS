import { BrandMark } from "@/components/brand/brand-mark";
import { Badge } from "@/components/ui/badge";
import { typography } from "@/components/ui/variants";

interface HomeHeaderProps {
  name: string;
  /** e.g. "JAMB 2027 Preparation". */
  examLabel: string;
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

export function HomeHeader({ name, examLabel, readiness, daysLeft }: HomeHeaderProps) {
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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className={typography.h1}>Welcome back, {name}.</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] text-slate-600">{examLabel}</span>
            {daysLeft === undefined ? null : (
              <Badge tone="brand">{daysLeft} days to go</Badge>
            )}
          </div>
        </div>

        {readiness === undefined ? null : (
          <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
            <span className="text-xs font-semibold text-slate-500">Readiness</span>
            <span className="mono-number text-xl font-semibold text-slate-950">{readiness}%</span>
          </div>
        )}
      </div>
    </header>
  );
}
