import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AnswerReview } from "@/components/results/answer-review";
import { RevisionButton } from "@/components/results/revision-button";
import { CompletionNotice } from "@/components/pwa/completion-notice";
import { Badge } from "@/components/ui/badge";
import { HeroPanel } from "@/components/ui/hero-panel";
import { buttonClasses, typography } from "@/components/ui/variants";
import { loadResult } from "@/features/results/service";
import { requireOnboardedUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

const inlineLink =
  "inline-flex min-h-11 items-center gap-1.5 rounded text-[12.5px] font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

export default async function ResultPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { user, supabase } = await requireOnboardedUser();
  const { kind, id } = await params;
  if (kind !== "exam" && kind !== "practice") notFound();
  const result = await loadResult(user.id, kind, id);
  if (!result) notFound();
  const { data: preference } = await supabase.from("student_exam_preferences").select("target_score").eq("user_id", user.id).eq("exam_body_id", result.examBodyId).eq("is_primary", true).maybeSingle();
  const weak = [...result.topics].filter(t => t.topicSlug && t.accuracy < 70).sort((a, b) => a.accuracy - b.accuracy || b.total - a.total).slice(0, 3);
  const strong = [...result.subjects].sort((a, b) => b.accuracy - a.accuracy)[0];
  const subjectName = (slug: string) => result.subjects.find(s => s.subjectSlug === slug)?.name;

  return (
    <div className="screen-enter mx-auto max-w-[760px] space-y-4 pb-6">
      <CompletionNotice userId={user.id} kind={kind} id={id} />

      <Link href="/progress" className={inlineLink}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Progress
      </Link>

      <HeroPanel eyebrow={result.scaled ? "Mock result" : "Practice result"}>
        <h1 className={cn("mt-2", typography.h1, "text-white")}>{result.title}</h1>
        <p className="mt-1 text-[12.5px] text-white/60">{dateFormatter.format(new Date(result.completedAt))}</p>
        <p className="mt-2.5 flex items-baseline gap-2">
          {/* The number is the headline; the label keeps it meaningful when read aloud. */}
          <span className="sr-only">Score:</span>
          <span className={cn("mono-number", typography.display)}>{result.score}</span>
          <span className="mono-number text-base font-semibold text-white/55">/ {result.maximum}</span>
        </p>
        <p className="mt-2.5 max-w-xl text-[12.5px] leading-[1.6] text-white/60">
          {result.scaled
            ? "Estimated mock score · 100 points per subject. This is not an official JAMB score."
            : "One mark per correct answer. No negative marking."}
        </p>
        {result.scaled && preference?.target_score != null ? (
          <p className="mt-4">
            <Badge tone={result.score >= preference.target_score ? "success" : "warning"} dot>
              Target {preference.target_score} ·{" "}
              {result.score >= preference.target_score
                ? "Target reached"
                : `${preference.target_score - result.score} points away`}
            </Badge>
          </p>
        ) : null}
      </HeroPanel>

      <dl className="grid grid-cols-3 gap-2">
        {([
          ["Correct", result.correct, "text-success-600"],
          ["Incorrect", result.incorrect, "text-danger-600"],
          ["Unanswered", result.unanswered, "text-slate-600"],
        ] as const).map(([label, value, tone]) => (
          <div key={label} className="flex flex-col-reverse rounded-2xl border border-slate-200 bg-white p-3 text-center">
            <dt className="mt-1 text-[10.5px] font-medium text-slate-500">{label}</dt>
            <dd className={cn("mono-number text-2xl font-semibold leading-none", tone)}>{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[12.5px] leading-[1.6] text-slate-600">
        {result.accuracy}% correct across all questions · {Math.floor(result.elapsedSeconds / 60)}m {result.elapsedSeconds % 60}s session elapsed.{" "}
        {strong && `Strongest subject in this attempt: ${strong.name}.`} Per-question timing was not recorded.
      </p>

      {/* One card, one row per subject — the approved breakdown, not a stack of cards. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-bold text-slate-950">Subject breakdown</h2>
        <div className="mt-3.5 space-y-3.5">
          {result.subjects.map(s => (
            <div key={s.key}>
              <div className="flex justify-between gap-3 text-[12.5px]">
                <h3 className="truncate font-semibold text-slate-950">{s.name}</h3>
                <span className="mono-number shrink-0 font-semibold text-slate-950">{s.correct}/{s.total} · {s.accuracy}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={s.accuracy}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${s.name} accuracy`}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
              >
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${s.accuracy}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">{s.incorrect} incorrect · {s.unanswered} unanswered</p>
            </div>
          ))}
        </div>
      </section>

      {/* Where the attempt went wrong, on the approved danger-tinted surface. */}
      <section className="space-y-3 rounded-2xl bg-danger-50 p-[18px]">
        <h2 className="text-[13px] font-bold text-danger-800">Where you struggled</h2>
        <p className="text-[12.5px] leading-[1.6] text-slate-600">
          Revisit up to 20 saved questions from a weak topic, with missed questions first. These percentages describe this attempt, not overall mastery.
        </p>
        {weak.length ? (
          weak.map(t => (
            <div key={t.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-danger-600/10 pt-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[12.5px] font-bold text-slate-800">{t.name}</h3>
                  {t.total < 5 ? <Badge tone="warning">Small sample</Badge> : null}
                </div>
                <p className="mt-0.5 text-[10.5px] text-slate-600">{subjectName(t.subjectSlug)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="mono-number text-[12.5px] font-bold text-danger-600">{t.correct}/{t.total} · {t.accuracy}%</span>
                <RevisionButton
                  input={{ resultId: id, kind, subjectSlug: t.subjectSlug, topicSlug: t.topicSlug! }}
                  className={buttonClasses({ variant: "secondary", size: "sm", className: "h-9 rounded-full border-danger-200 text-xs" })}
                >
                  Practise {t.name}
                </RevisionButton>
              </div>
            </div>
          ))
        ) : (
          <p className="border-t border-danger-600/10 pt-3 text-[12.5px] leading-[1.6] text-slate-600">
            No categorised topic scored below 70% in this attempt. Review missed answers or try another practice session.
          </p>
        )}
        <Link href="/progress/mistakes" className={inlineLink}>
          Review my mistake bank <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-bold text-slate-950">Topic breakdown</h2>
        <div className="mt-2 divide-y divide-slate-100">
          {result.topics.map(t => (
            <div key={t.key} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[12.5px] font-semibold text-slate-950">{subjectName(t.subjectSlug)} · {t.name}</h3>
                {t.total < 5 ? <Badge tone="warning">Small sample</Badge> : null}
              </div>
              <p className="mono-number mt-1 text-[11.5px] text-slate-500">
                {t.correct}/{t.total} correct · {t.incorrect} incorrect · {t.unanswered} unanswered · {t.accuracy}%
              </p>
            </div>
          ))}
        </div>
      </section>

      <AnswerReview items={result.items} />

      {/* The two ways forward from a result, as the approved system pairs them. */}
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Link href="/progress/mistakes" className={buttonClasses({ variant: "dark", size: "lg", className: "sm:flex-1" })}>Practise my mistakes</Link>
        <Link href="/mock" className={buttonClasses({ variant: "secondary", size: "lg", className: "sm:flex-1" })}>Take another mock</Link>
      </div>
    </div>
  );
}
