import { BrandMark } from "@/components/brand/brand-mark";

interface HomeHeaderProps {
  name: string;
  examLabel: string;
  daysLeft: number;
  readiness: number;
  readinessDelta: number;
}

export function HomeHeader({ name, examLabel, daysLeft, readiness, readinessDelta }: HomeHeaderProps) {
  return (
    <header>
      <div className="mb-5 flex items-center justify-between lg:hidden">
        <BrandMark />
        <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-950 text-xs font-extrabold text-white" aria-label={`${name} profile`}>
          IA
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[28px]">
            Good evening, {name}.
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-500">{examLabel}</span>
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-brand-500">
              {daysLeft} days to JAMB
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none">
          <span className="text-xs font-semibold text-slate-500">JAMB Readiness</span>
          <span className="mono-number text-xl font-extrabold text-slate-950">{readiness}%</span>
          <span className="text-[11px] font-bold text-emerald-700">↑ {readinessDelta}% this month</span>
        </div>
      </div>
    </header>
  );
}
