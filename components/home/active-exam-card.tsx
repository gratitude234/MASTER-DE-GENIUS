import Link from "next/link";
import { Clock3, PlayCircle } from "lucide-react";

import { buttonClasses, typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";
import type { ActiveExamAttemptSummary } from "@/features/exams/types";

function timeRemaining(expiresAt: string) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
}

export function ActiveExamCard({ attempt }: { attempt: ActiveExamAttemptSummary }) {
  return (
    <section className="rounded-2xl border border-brand-200 bg-brand-50 px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-3.5 sm:flex-nowrap">
        <div aria-hidden="true" className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl bg-brand-500 text-white"><PlayCircle className="h-[18px] w-[18px]" /></div>
        <div className="min-w-0 flex-1">
          <div className={cn(typography.eyebrow, "text-brand-500")}>Exam in progress</div>
          <h2 className="mt-0.5 text-[14.5px] font-bold text-slate-950">{attempt.examName} Mock — {attempt.totalQuestions} questions</h2>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-600">
            <span>{attempt.answeredCount}/{attempt.totalQuestions} answered</span>
            <span aria-hidden="true">·</span>
            <span>{attempt.flaggedCount} flagged</span>
            <span aria-hidden="true">·</span>
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
