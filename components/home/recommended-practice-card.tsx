import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RevisionButton } from "@/components/results/revision-button";
import { buttonClasses } from "@/components/ui/variants";
import type { PracticeRecommendation } from "@/features/home/recommendation";

/**
 * The dashboard's one dominant call to action.
 *
 * What it offers comes entirely from `recommendPractice`, so Home never decides
 * for itself what is weak. When there is a weak area it starts a revision
 * session over that attempt's own questions; when there is not, it says so
 * rather than dressing a cold start up as a diagnosis.
 */
export function RecommendedPracticeCard({ recommendation }: { recommendation: PracticeRecommendation }) {
  if (recommendation.kind === "start") {
    return (
      <section className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-soft">
        <div className="px-5 py-6 sm:px-7 lg:flex lg:items-center lg:justify-between lg:gap-8">
          <div className="min-w-0">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
              {recommendation.hasHistory ? "Keep going" : "Start here"}
            </h2>
            <p className="mt-3 text-xl font-extrabold tracking-[-0.02em] sm:text-2xl">
              {recommendation.hasHistory
                ? "Nothing is falling behind right now."
                : "Your first practice session"}
            </p>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/70">
              {recommendation.hasHistory
                ? "Every topic in your last attempt scored 70% or above. Another session will keep your accuracy where it is and surface anything new."
                : "Pick a subject and answer a short set. Once you finish, this space shows the exact topics to work on next."}
            </p>
          </div>

          <Link
            href="/practice"
            className={buttonClasses({
              variant: "primary",
              size: "lg",
              className: "mt-5 w-full focus-visible:ring-white focus-visible:ring-offset-slate-950 lg:mt-0 lg:w-auto",
            })}
          >
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
    <section className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-soft">
      <div className="px-5 py-6 sm:px-7 lg:flex lg:items-center lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
            Continue where you need it most
          </h2>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-xl font-extrabold tracking-[-0.02em] sm:text-2xl">{title}</p>
            {isTopic ? <span className="text-sm font-semibold text-white/70">{recommendation.subjectName}</span> : null}
          </div>
          {/* Scoped to the attempt it came from — never presented as overall mastery. */}
          <p className="mt-3 text-sm text-white/70">
            {recommendation.correct} of {recommendation.total} correct ({recommendation.accuracy}%) in your latest
            attempt.
          </p>
        </div>

        <div className="mt-5 lg:mt-0 lg:shrink-0">
          <RevisionButton
            input={{
              resultId: recommendation.resultId,
              kind: recommendation.resultKind,
              subjectSlug: recommendation.subjectSlug,
              ...(isTopic ? { topicSlug: recommendation.topicSlug } : {}),
            }}
            className={buttonClasses({
              variant: "primary",
              size: "lg",
              fullWidth: true,
              className: "focus-visible:ring-white focus-visible:ring-offset-slate-950 lg:w-auto",
            })}
            errorClassName="mt-2 text-sm font-semibold text-danger-200"
          >
            Practise {title}
          </RevisionButton>
        </div>
      </div>
    </section>
  );
}
