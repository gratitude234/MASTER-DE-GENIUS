import Link from "next/link";
import { Clock3, PlayCircle } from "lucide-react";

import type { ActiveExamAttemptSummary } from "@/features/exams/types";

function timeRemaining(expiresAt: string) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
}

export function ActiveExamCard({ attempt }: { attempt: ActiveExamAttemptSummary }) {
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white"><PlayCircle className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-blue-700">Exam in progress</div>
          <div className="mt-1 text-base font-extrabold text-slate-950">{attempt.examName} Mock</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-600">
            <span>{attempt.answeredCount}/{attempt.totalQuestions} answered</span>
            <span>{attempt.flaggedCount} flagged</span>
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {timeRemaining(attempt.expiresAt)} left</span>
          </div>
        </div>
        <Link href={`/exam/${attempt.id}`} className="shrink-0 rounded-xl bg-slate-950 px-3.5 py-2 text-xs font-extrabold text-white">Resume</Link>
      </div>
    </section>
  );
}
