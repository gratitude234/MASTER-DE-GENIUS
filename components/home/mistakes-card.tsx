import Link from "next/link";
import { RotateCcw } from "lucide-react";

export function MistakesCard({ count }: { count: number }) {
  const label = count === 1 ? "mistake ready for review" : "mistakes ready for review";

  return (
    // No visible title, so the region carries its own name for screen readers.
    <section aria-label={`${count} ${label}`} className="flex min-h-[190px] flex-col rounded-2xl bg-brand-50 p-5">
      <div aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-xl bg-white text-brand-500 shadow-sm">
        <RotateCcw className="h-[18px] w-[18px]" />
      </div>
      <div className="mono-number mt-5 text-[26px] font-black leading-none tracking-[-0.04em] text-slate-950">{count}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{label}</div>
      <Link
        href="/progress/mistakes"
        className="mt-auto self-start rounded pt-5 text-xs font-extrabold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        {count === 0 ? "Open mistake bank →" : "Review mistakes →"}
      </Link>
    </section>
  );
}
