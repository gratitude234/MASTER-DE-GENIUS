import Link from "next/link";
import { Clock3, PlayCircle } from "lucide-react";

import { buttonClasses, typography } from "@/components/ui/variants";
import type { ActiveExamAttemptSummary } from "@/features/exams/types";

function timeRemaining(expiresAt: string) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
}

export function ActiveExamCard({ attempt }: { attempt: ActiveExamAttemptSummary }) {
  return (
    <section className="rounded-2xl border border-brand-500/20 bg-brand-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <div aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-white"><PlayCircle className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-600">Exam in progress</div>
          <h2 className={`mt-1 ${typography.h2}`}>{attempt.examName} Mock</h2>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-600">
            <span>{attempt.answeredCount}/{attempt.totalQuestions} answered</span>
            <span>{attempt.flaggedCount} flagged</span>
            <span className="inline-flex items-center gap-1"><Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> {timeRemaining(attempt.expiresAt)} left</span>
          </div>
        </div>
        {/* An unfinished exam is the most urgent thing on the page: full control size, not a text link. */}
        <Link href={`/exam/${attempt.id}`} className={buttonClasses({ variant: "dark", size: "md", className: "w-full shrink-0 sm:w-auto" })}>
          Resume exam
        </Link>
      </div>
    </section>
  );
}
