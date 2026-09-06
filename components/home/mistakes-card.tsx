import Link from "next/link";
import { RotateCcw } from "lucide-react";

export function MistakesCard({ count }: { count: number }) {
  return (
    <section className="flex min-h-[190px] flex-col rounded-2xl bg-indigo-50 p-5">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-brand-500 shadow-sm">
        <RotateCcw className="h-[18px] w-[18px]" />
      </div>
      <div className="mt-5 text-[26px] font-black tracking-[-0.04em] text-slate-950">{count}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">mistakes ready for review</div>
      <Link href="/progress/mistakes" className="mt-auto pt-5 text-xs font-extrabold text-brand-500">
        Review mistakes →
      </Link>
    </section>
  );
}
