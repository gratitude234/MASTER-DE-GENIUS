interface SubjectScore {
  name: string;
  score: number;
}

export function SubjectPerformance({ subjects }: { subjects: SubjectScore[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-extrabold text-slate-950">Subject performance</h2>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Last 30 days</span>
      </div>
      <div className="space-y-4">
        {subjects.map((subject) => (
          <div key={subject.name}>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600">{subject.name}</span>
              <span className="mono-number font-extrabold text-slate-950">{subject.score}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${subject.score}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
