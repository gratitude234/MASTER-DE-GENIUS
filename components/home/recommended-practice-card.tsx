import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";

interface RecommendedPracticeCardProps {
  subject: string;
  topic: string;
  accuracy: number;
  questions: number;
  minutes: number;
}

export function RecommendedPracticeCard({ subject, topic, accuracy, questions, minutes }: RecommendedPracticeCardProps) {
  return (
    <section className="overflow-hidden rounded-[18px] bg-slate-950 text-white shadow-soft">
      <div className="px-5 py-5 sm:px-7 sm:py-6 lg:flex lg:items-center lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/45">
            Continue where you need it most
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <h2 className="text-xl font-extrabold tracking-[-0.02em] sm:text-2xl">{subject}</h2>
            <span className="text-sm font-semibold text-white/55">{topic}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-white/55">
            <span>Recent accuracy <strong className="text-white/90">{accuracy}%</strong></span>
            <span>{questions} questions</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Est. {minutes} min</span>
          </div>
        </div>

        <Link
          href="/practice?quick=waves"
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 text-sm font-extrabold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:mt-0 lg:w-auto"
        >
          Start Practice
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
