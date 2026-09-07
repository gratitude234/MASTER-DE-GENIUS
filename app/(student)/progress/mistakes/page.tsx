import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { RevisionButton } from "@/components/results/revision-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { buttonClasses, typography } from "@/components/ui/variants";
import { mistakeBank } from "@/features/results/grading";
import { loadHistory } from "@/features/results/service";
import { requireOnboardedUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const inlineLink =
  "inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-extrabold text-brand-600 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

export default async function MistakesPage({ searchParams }: { searchParams: Promise<{ subject?: string; topic?: string; status?: string; page?: string }> }) {
  const { user } = await requireOnboardedUser();
  const search = await searchParams;
  const bank = mistakeBank(await loadHistory(user.id));
  const mastered = search.status === "mastered";
  const subject = search.subject ?? "";
  const topic = search.topic ?? "";
  const subjects = [...new Map(bank.map(m => [m.item.question.subject.slug, m.item.question.subject.name])).entries()];
  const topics = [...new Map(bank.filter(m => !subject || m.item.question.subject.slug === subject).filter(m => m.item.question.topic).map(m => [m.item.question.topic!.slug, m.item.question.topic!.name])).entries()];
  const filtered = bank.filter(m => m.mastered === mastered && (!subject || m.item.question.subject.slug === subject) && (!topic || m.item.question.topic?.slug === topic));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(search.page ?? "1", 10) || 1));
  const pageLink = (n: number) => `/progress/mistakes?${new URLSearchParams({ subject, topic, status: mastered ? "mastered" : "active", page: String(n) })}`;
  const revisionSubjects = [...new Map(filtered.map(m => [m.item.question.subject.slug, m.item.question.subject.name])).entries()];

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/progress" className={inlineLink}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Progress
      </Link>

      <header>
        <h1 className={typography.h1}>Your mistake bank</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Wrong and unanswered questions from completed attempts. Two consecutive correct answers in separate completed
          sessions mark a question as mastered. Missing it again returns it here.
        </p>
      </header>

      <form className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <label htmlFor="mistakes-subject" className="block text-xs font-bold text-slate-700">Subject</label>
          <Select id="mistakes-subject" name="subject" defaultValue={subject} containerClassName="mt-1.5">
            <option value="">All subjects</option>
            {subjects.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="mistakes-topic" className="block text-xs font-bold text-slate-700">Topic</label>
          <Select id="mistakes-topic" name="topic" defaultValue={topic} containerClassName="mt-1.5">
            <option value="">All topics</option>
            {topics.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="mistakes-status" className="block text-xs font-bold text-slate-700">Status</label>
          <Select id="mistakes-status" name="status" defaultValue={mastered ? "mastered" : "active"} containerClassName="mt-1.5">
            <option value="active">Needs review</option>
            <option value="mastered">Mastered</option>
          </Select>
        </div>
        {/* No `type`: this is the form's submit control, and the filters are a GET. */}
        <Button variant="dark" size="lg" className="self-end">Apply filters</Button>
      </form>

      <p aria-live="polite" className="text-sm font-bold text-slate-950">
        {filtered.length} {mastered ? "mastered questions" : filtered.length === 1 ? "question to revisit" : "questions to revisit"}
      </p>

      {!mastered && revisionSubjects.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-brand-500/20 bg-brand-50 p-4">
          <h2 className={typography.h2}>Practise my mistakes</h2>
          <p className="text-sm text-slate-600">Choose a subject. Each session uses up to 20 of your saved mistakes.</p>
          <div className="flex flex-wrap gap-2">
            {revisionSubjects.map(([slug, name]) => (
              <RevisionButton key={slug} input={{ mistakes: true, subjectSlug: slug, ...(topic ? { topicSlug: topic } : {}) }}>
                {name}
              </RevisionButton>
            ))}
          </div>
        </section>
      ) : null}

      {/*
        Two genuinely different situations. "Nothing here yet" is an invitation
        to start; "nothing matches" is a filter to loosen. Collapsing them into
        one message would leave a new student thinking their filters were wrong.
      */}
      {!filtered.length ? (
        bank.length ? (
          <EmptyState
            headingLevel={2}
            title="No questions match these filters"
            description={
              mastered
                ? "You have not mastered anything under this subject and topic yet. Try a different subject, or switch back to questions that still need review."
                : "Nothing to revisit under this subject and topic. Try another subject, or switch to mastered questions."
            }
            action={<Link href="/progress/mistakes" className={buttonClasses({ variant: "secondary", size: "lg" })}>Clear filters</Link>}
          />
        ) : (
          <EmptyState
            headingLevel={2}
            title="Your mistake bank is empty"
            description="Complete a practice session or a mock and every question you miss is saved here, ready to practise until you have it twice in a row."
            action={<Link href="/practice" className={buttonClasses({ variant: "dark", size: "lg" })}>Start practice</Link>}
          />
        )
      ) : null}

      {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(m => (
        <article key={m.key} className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cn(typography.eyebrow, "text-brand-600")}>
              {m.item.question.subject.name} · {m.item.question.topic?.name ?? "Uncategorised"}
            </h2>
            <Badge tone={m.mastered ? "success" : "warning"} dot>
              {m.mastered ? "Mastered" : `Streak ${m.streak} of 2`}
            </Badge>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-900">{m.item.question.prompt}</p>
          <p className="mt-3 text-xs text-slate-500">
            {m.failures} missed {m.failures === 1 ? "attempt" : "attempts"}
          </p>
          <Link href={`/progress/results/${m.kind}/${m.resultId}#answer-review`} className={cn(inlineLink, "mt-1")}>
            Review answer &amp; explanation <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </article>
      ))}

      {pages > 1 ? (
        <nav aria-label="Mistake pages" className="flex min-h-12 items-center justify-between gap-3">
          {page > 1 ? <Link href={pageLink(page - 1)} className={inlineLink}>← Previous</Link> : <span />}
          <span className="mono-number text-sm font-semibold text-slate-500">{page} / {pages}</span>
          {page < pages ? <Link href={pageLink(page + 1)} className={inlineLink}>Next →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
