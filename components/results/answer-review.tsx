"use client";
import { useState } from "react";
import { Check, ChevronDown, CircleHelp, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { typography } from "@/components/ui/variants";
import type { Outcome, ReviewItem } from "@/features/results/grading";
import { cn } from "@/lib/utils";

/**
 * Outcome is never carried by colour alone: each one keeps its own word and its
 * own icon, so the state survives a greyscale screen and a screen reader.
 */
const OUTCOME = {
  correct: { label: "Correct", tone: "text-success-700", Icon: Check },
  incorrect: { label: "Incorrect", tone: "text-danger-700", Icon: X },
  unanswered: { label: "Unanswered", tone: "text-warning-800", Icon: CircleHelp },
} as const satisfies Record<Outcome, { label: string; tone: string; Icon: typeof Check }>;

export function AnswerReview({ items }: { items: ReviewItem[] }) {
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [filter, setFilter] = useState<Outcome | "all" | "flagged">("all");
  const subjects = [...new Map(items.map(i => [i.question.subject.slug, i.question.subject.name])).entries()];
  const topics = [...new Map(items.filter(i => !subject || i.question.subject.slug === subject).map(i => [i.question.topic?.slug ?? "uncategorised", i.question.topic?.name ?? "Uncategorised"])).entries()];
  const visible = items.filter(i => (!subject || i.question.subject.slug === subject)
    && (!topic || (i.question.topic?.slug ?? "uncategorised") === topic)
    && (filter === "all" || (filter === "flagged" ? i.flagged : i.outcome === filter)));

  return (
    <section id="answer-review" className="scroll-mt-6 space-y-4">
      <h2 className={typography.h2}>Answer review</h2>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div>
          <label htmlFor="review-subject" className="block text-xs font-bold text-slate-700">Subject</label>
          <Select id="review-subject" value={subject} onChange={e => { setSubject(e.target.value); setTopic(""); }} containerClassName="mt-1.5">
            <option value="">All subjects</option>
            {subjects.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="review-topic" className="block text-xs font-bold text-slate-700">Topic</label>
          <Select id="review-topic" value={topic} onChange={e => setTopic(e.target.value)} containerClassName="mt-1.5">
            <option value="">All topics</option>
            {topics.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="review-outcome" className="block text-xs font-bold text-slate-700">Show</label>
          <Select id="review-outcome" value={filter} onChange={e => setFilter(e.target.value as typeof filter)} containerClassName="mt-1.5">
            {(["all", "correct", "incorrect", "unanswered", "flagged"] as const).map(v => (
              <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>
            ))}
          </Select>
        </div>
      </div>

      <p aria-live="polite" className="text-sm font-semibold text-slate-600">{visible.length} questions</p>

      {!visible.length ? (
        <EmptyState
          title="No questions match these filters"
          description="Widen the subject, topic or outcome to see the rest of this attempt."
        />
      ) : null}

      {visible.map(item => {
        const outcome = OUTCOME[item.outcome];
        return (
          <details key={item.id} className="group rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <summary className="flex min-h-12 cursor-pointer list-none items-start gap-3 rounded text-sm font-bold leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
              <span className="min-w-0 flex-1">
                Question {item.position} · {item.question.subject.name} ·{" "}
                <span className={cn("inline-flex items-center gap-1", outcome.tone)}>
                  <outcome.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {outcome.label}
                </span>
                {item.flagged ? " · Flagged" : ""}
                <span className="mt-1 block font-normal text-slate-600">
                  {item.question.prompt.slice(0, 100)}{item.question.prompt.length > 100 ? "…" : ""}
                </span>
              </span>
              <ChevronDown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>

            <div className="mt-4 space-y-4">
              {item.question.passage ? (
                <details className="group/passage rounded-xl bg-slate-50 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
                    View passage
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open/passage:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap leading-7">{item.question.passage.body}</p>
                </details>
              ) : null}

              <p className="whitespace-pre-wrap leading-7">{item.question.prompt}</p>

              {item.question.assets.map(asset => (
                <figure key={asset.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt={asset.altText || "Question illustration"} loading="lazy" className="max-h-96 max-w-full rounded-xl object-contain" />
                  {asset.caption && <figcaption className="mt-2 text-sm text-slate-600">{asset.caption}</figcaption>}
                </figure>
              ))}

              <ul className="space-y-2">
                {item.question.options.map(option => (
                  <li
                    key={option.key}
                    className={cn(
                      "rounded-xl border p-3 text-sm leading-6",
                      option.key === item.correct ? "border-success-300 bg-success-50" : "border-slate-200",
                    )}
                  >
                    <strong>{option.key}.</strong> {option.text}
                    {option.key === item.selected && <strong> · Your answer</strong>}
                    {option.key === item.correct && <strong className="text-success-800"> · Correct answer</strong>}
                  </li>
                ))}
              </ul>

              {!item.selected && <p className="text-sm font-semibold text-warning-800">You left this question unanswered.</p>}

              <div className="rounded-xl bg-brand-50 p-4">
                <h3 className={typography.h2}>Explanation</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                  {item.explanation || "An explanation has not been provided for this question yet."}
                </p>
              </div>

              <p className="text-xs text-slate-500">
                {item.question.topic?.name ?? "Uncategorised topic"} · {item.question.difficulty ?? "Difficulty not specified"}
              </p>
            </div>
          </details>
        );
      })}
    </section>
  );
}
