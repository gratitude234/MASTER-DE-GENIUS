import Link from "next/link";

interface WeakArea {
  subject: string;
  topic: string;
  score: number;
}

export function WeakAreasCard({ areas }: { areas: WeakArea[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-3 text-sm font-extrabold text-slate-950">Weak areas</div>
      <div className="divide-y divide-slate-100">
        {areas.map((area) => (
          <div className="flex items-center gap-3 py-3" key={`${area.subject}-${area.topic}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-extrabold text-slate-900">{area.topic}</div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-400">{area.subject}</div>
            </div>
            <div className="mono-number text-xs font-extrabold text-red-600">{area.score}%</div>
            <Link href={`/practice?subject=${area.subject.toLowerCase()}&topic=${encodeURIComponent(area.topic)}`} className="rounded-lg bg-slate-100 px-2.5 py-2 text-[10px] font-extrabold text-slate-700">
              Practice
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
