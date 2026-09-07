import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RevisionButton } from "@/components/results/revision-button";
import { buttonClasses, typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";
import type { PracticeRecommendation } from "@/features/home/recommendation";

/**
 * The dashboard's one dominant call to action, and the only ink-on-white panel
 * on Home.
 *
 * What it offers comes entirely from `recommendPractice`, so Home never decides
 * for itself what is weak. When there is a weak area it starts a revision
 * session over that attempt's own questions; when there is not, it says so
 * rather than dressing a cold start up as a diagnosis.
 */

/** White on ink: the approved action treatment inside the dark hero. */
const heroAction = buttonClasses({
  variant: "secondary",
  size: "md",
  className:
    "h-11 w-full border-0 bg-white text-slate-950 hover:bg-slate-100 focus-visible:ring-white focus-visible:ring-offset-slate-950 lg:w-auto",
});

export function RecommendedPracticeCard({ recommendation }: { recommendation: PracticeRecommendation }) {
  if (recommendation.kind === "start") {
    return (
      <section className="overflow-hidden rounded-3xl bg-slate-950 px-[22px] py-6 text-white">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
          <div className="min-w-0">
            <h2 className={cn(typography.eyebrow, "text-white/50")}>
              {recommendation.hasHistory ? "Keep going" : "Start here"}
            </h2>
            <p className="mt-2 font-serif text-xl font-semibold tracking-[-0.01em]">
              {recommendation.hasHistory
                ? "Nothing is falling behind right now."
                : "Your first practice session"}
            </p>
            <p className="mt-2 max-w-[420px] text-[13px] leading-[1.5] text-white/65">
              {recommendation.hasHistory
                ? "Every topic in your last attempt scored 70% or above. Another session will keep your accuracy where it is and surface anything new."
                : "Pick a subject and answer a short set. Once you finish, this space shows the exact topics to work on next."}
            </p>
          </div>

          <Link href="/practice" className={cn(heroAction, "shrink-0")}>
            {recommendation.hasHistory ? "Practise again" : "Start practice"}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    );
  }

  const isTopic = recommendation.kind === "topic";
  const title = isTopic ? recommendation.topicName : recommendation.subjectName;

  return (
    <section className="overflow-hidden rounded-3xl bg-slate-950 px-[22px] py-6 text-white">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="min-w-0">
          <h2 className={cn(typography.eyebrow, "text-white/50")}>
            Continue where you need it most
          </h2>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="font-serif text-xl font-semibold tracking-[-0.01em]">{title}</p>
            {isTopic ? <span className="text-[13px] font-semibold text-white/65">{recommendation.subjectName}</span> : null}
          </div>
          {/* Scoped to the attempt it came from — never presented as overall mastery. */}
          <p className="mt-2 max-w-[420px] text-[13px] leading-[1.5] text-white/65">
            {recommendation.correct} of {recommendation.total} correct ({recommendation.accuracy}%) in your latest
            attempt.
          </p>
        </div>

        <div className="lg:shrink-0">
          <RevisionButton
            input={{
              resultId: recommendation.resultId,
              kind: recommendation.resultKind,
              subjectSlug: recommendation.subjectSlug,
              ...(isTopic ? { topicSlug: recommendation.topicSlug } : {}),
            }}
            className={heroAction}
            errorClassName="mt-2 text-[13px] font-semibold text-danger-200"
          >
            Practise {title}
          </RevisionButton>
        </div>
      </div>
    </section>
  );
}
