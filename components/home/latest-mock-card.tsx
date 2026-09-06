import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

interface LatestMockCardProps {
  score: number;
  total: number;
  delta: number;
  date: string;
}

export function LatestMockCard({ score, total, delta, date }: LatestMockCardProps) {
  return (
    <section className="flex min-h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="text-sm font-extrabold text-slate-950">Latest mock</div>
      <div className="mt-4 flex items-end gap-2">
        <div className="mono-number text-[32px] font-black tracking-[-0.05em] text-slate-950">{score}</div>
        <div className="mono-number pb-1 text-sm font-bold text-slate-400">/ {total}</div>
      </div>
      <div className="mt-2 text-xs font-bold text-emerald-700">↑ {delta} points from your previous attempt</div>
      <div className="mt-1 text-[11px] text-slate-400">{date}</div>
      <Link href="/progress" className="mt-auto flex items-center gap-1.5 pt-5 text-xs font-extrabold text-brand-500">
        View result <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
