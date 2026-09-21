import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { RevisionButton } from "@/components/results/revision-button";
import { buttonClasses, typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";
import type { PracticeRecommendation } from "@/features/home/recommendation";

/**
 * The one personalised learning card: "Continue Mathematics — 6/20 correct on
 * your latest attempt".
 *
 * Exactly one, never a stack. What it offers comes entirely from
 * `recommendPractice`, so the dashboard never decides for itself what is weak.
 *
 * When there is nothing to recommend it renders nothing at all. The old card
 * filled that case with a dark full-bleed hero saying "nothing is falling
 * behind" — a whole screen-height panel to say there was no news, above the
 * student's quick actions. A cold-start student is served by Quick Actions and
 * the empty state further down; they do not need to be told twice.
 */
export function ContinueLearningCard({ recommendation }: { recommendation: PracticeRecommendation }) {
  if (recommendation.kind === "start") return null;

  const isTopic = recommendation.kind === "topic";
  const title = isTopic ? recommendation.topicName : recommendation.subjectName;

  return (
    <section aria-labelledby="continue-learning-heading" className="rounded-2xl bg-slate-950 p-4 text-white sm:p-[18px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <h2 id="continue-learning-heading" className={cn(typography.eyebrow, "text-white/50")}>Continue learning</h2>
          <p className="mt-1.5 font-serif text-[17px] font-semibold tracking-[-0.01em] sm:text-lg">
            Continue {title}
          </p>
          {/* Scoped to the attempt it came from — never presented as overall mastery. */}
          <p className="mt-1 text-[12.5px] leading-[1.5] text-white/65">
            {isTopic ? `${recommendation.subjectName} · ` : ""}
            {recommendation.correct} of {recommendation.total} correct on your latest attempt
          </p>
        </div>

        <div className="sm:shrink-0">
          <RevisionButton
            input={{
              resultId: recommendation.resultId,
              kind: recommendation.resultKind,
              subjectSlug: recommendation.subjectSlug,
              ...(isTopic ? { topicSlug: recommendation.topicSlug } : {}),
            }}
            className={buttonClasses({
              variant: "secondary",
              size: "md",
              className: "w-full border-0 bg-white text-slate-950 hover:bg-slate-100 focus-visible:ring-white focus-visible:ring-offset-slate-950 sm:w-auto",
            })}
            errorClassName="mt-2 text-[12.5px] font-semibold text-danger-200"
          >
            Practise {title}
          </RevisionButton>
        </div>
      </div>
    </section>
  );
}

/**
 * The cold-start alternative, shown only when the student has no history at
 * all. One line and one link — not a hero.
 */
export function StartPracticeCard() {
  return (
    <section aria-labelledby="start-practice-heading" className="rounded-2xl bg-slate-950 p-4 text-white sm:p-[18px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <h2 id="start-practice-heading" className={cn(typography.eyebrow, "text-white/50")}>Start here</h2>
          <p className="mt-1.5 font-serif text-[17px] font-semibold tracking-[-0.01em] sm:text-lg">
            Your first practice session
          </p>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-white/65">
            Pick a subject and answer a short set. Once you finish, this space shows what to work on next.
          </p>
        </div>
        <Link
          href="/practice"
          className={buttonClasses({
            variant: "secondary",
            size: "md",
            className: "w-full shrink-0 border-0 bg-white text-slate-950 hover:bg-slate-100 focus-visible:ring-white focus-visible:ring-offset-slate-950 sm:w-auto",
          })}
        >
          Start practice
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
