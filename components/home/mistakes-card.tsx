import Link from "next/link";

/**
 * The mistake bank's entry point. Warm cream rather than a bordered white card:
 * it is the one place on the dashboard that asks for a return visit, and the
 * approved system gives it its own surface so it does not read as another
 * statistic.
 */
export function MistakesCard({ count }: { count: number }) {
  const label = count === 1 ? "mistake ready for review" : "mistakes ready for review";

  return (
    // No visible title, so the region carries its own name for screen readers.
    <section className="flex min-h-full flex-col rounded-2xl bg-warning-100 p-[18px]">
      <h2 className="text-[13px] font-bold text-slate-950">Mistakes ready</h2>
      <div className="mono-number mt-2.5 text-[30px] font-semibold leading-none tracking-[-0.02em] text-slate-950">{count}</div>
      <div className="mt-1 text-[11.5px] font-medium text-warning-700">{label}</div>
      <Link
        href="/progress/mistakes"
        className="mt-auto flex min-h-11 items-center self-start rounded pt-3 text-xs font-bold text-warning-700 hover:text-warning-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        {count === 0 ? "Open mistake bank →" : "Review mistakes →"}
      </Link>
    </section>
  );
}
