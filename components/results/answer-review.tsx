"use client";
import { useState } from "react";
import type { Outcome, ReviewItem } from "@/features/results/grading";
export function AnswerReview({ items }: { items: ReviewItem[] }) {
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [filter, setFilter] = useState<Outcome | "all" | "flagged">("all");
  const subjects = [...new Map(items.map(i => [i.question.subject.slug, i.question.subject.name])).entries()];
  const topics = [...new Map(items.filter(i => !subject || i.question.subject.slug === subject).map(i => [i.question.topic?.slug ?? "uncategorised", i.question.topic?.name ?? "Uncategorised"])).entries()];
  const visible = items.filter(i => (!subject || i.question.subject.slug === subject)
    && (!topic || (i.question.topic?.slug ?? "uncategorised") === topic)
    && (filter === "all" || (filter === "flagged" ? i.flagged : i.outcome === filter)));
  return <section id="answer-review" className="space-y-4">
    <h2 className="text-xl font-bold">Answer review</h2>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm font-semibold">Subject<select className="mt-1 min-h-12 w-full rounded-xl border bg-white p-3" value={subject} onChange={e => { setSubject(e.target.value); setTopic(""); }}><option value="">All subjects</option>{subjects.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select></label>
      <label className="text-sm font-semibold">Topic<select className="mt-1 min-h-12 w-full rounded-xl border bg-white p-3" value={topic} onChange={e => setTopic(e.target.value)}><option value="">All topics</option>{topics.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select></label>
      <label className="text-sm font-semibold">Show<select className="mt-1 min-h-12 w-full rounded-xl border bg-white p-3" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>{["all", "correct", "incorrect", "unanswered", "flagged"].map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</select></label>
    </div>
    <p aria-live="polite" className="text-sm text-slate-600">{visible.length} questions</p>
    {!visible.length && <p className="rounded-2xl border bg-white p-5">No questions match these filters.</p>}
    {visible.map(item => <details key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <summary className="min-h-12 cursor-pointer text-sm font-bold leading-6">Question {item.position} · {item.question.subject.name} · <span className={item.outcome === "correct" ? "text-emerald-700" : "text-amber-800"}>{item.outcome}</span>{item.flagged ? " · Flagged" : ""}<p className="mt-1 font-normal text-slate-600">{item.question.prompt.slice(0, 100)}{item.question.prompt.length > 100 ? "…" : ""}</p></summary>
      <div className="mt-4 space-y-4">
        {item.question.passage && <details className="rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer font-semibold">View passage</summary><p className="mt-3 whitespace-pre-wrap leading-7">{item.question.passage.body}</p></details>}
        <p className="whitespace-pre-wrap leading-7">{item.question.prompt}</p>
        {item.question.assets.map(asset => <figure key={asset.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.url} alt={asset.altText || "Question illustration"} loading="lazy" className="max-h-96 max-w-full rounded-xl object-contain" />
          {asset.caption && <figcaption className="mt-2 text-sm text-slate-600">{asset.caption}</figcaption>}
        </figure>)}
        <ul className="space-y-2">{item.question.options.map(option => <li key={option.key} className={`rounded-xl border p-3 text-sm leading-6 ${option.key === item.correct ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}><strong>{option.key}.</strong> {option.text}{option.key === item.selected && <strong> · Your answer</strong>}{option.key === item.correct && <strong className="text-emerald-800"> · Correct answer</strong>}</li>)}</ul>
        {!item.selected && <p className="text-sm font-semibold text-amber-800">You left this question unanswered.</p>}
        <div className="rounded-xl bg-blue-50 p-4"><h3 className="font-bold">Explanation</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{item.explanation || "An explanation has not been provided for this question yet."}</p></div>
        <p className="text-xs text-slate-500">{item.question.topic?.name ?? "Uncategorised topic"} · {item.question.difficulty ?? "Difficulty not specified"}</p>
      </div>
    </details>)}
  </section>;
}
