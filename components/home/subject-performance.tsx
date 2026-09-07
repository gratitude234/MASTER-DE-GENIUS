import { typography } from "@/components/ui/variants";

export interface SubjectScore {
  name: string;
  accuracy: number;
  correct: number;
  total: number;
}

/**
 * Per-subject accuracy. `caption` states the period the numbers actually cover
 * — the component must never assert a window the caller did not measure.
 */
export function SubjectPerformance({ subjects, caption }: { subjects: SubjectScore[]; caption: string }) {
  return (
    <section className="flex min-h-full flex-col rounded-2xl border border-slate-200 bg-white p-[18px]">
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 className={typography.h2}>Subject performance</h2>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{caption}</span>
      </div>
      <div className="space-y-3">
        {subjects.map((subject) => (
          <div key={subject.name}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-semibold text-slate-800">{subject.name}</span>
              <span className="mono-number shrink-0 font-semibold text-slate-950">
                {subject.correct}/{subject.total} · {subject.accuracy}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={subject.accuracy}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${subject.name} accuracy`}
              className="h-[5px] overflow-hidden rounded-full bg-slate-100"
            >
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${subject.accuracy}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
