import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth";
import { loadHistory } from "@/features/results/service";
import { mistakeBank } from "@/features/results/grading";
import { RevisionButton } from "@/components/results/revision-button";
export const dynamic = "force-dynamic";
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
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const page = Math.min(pages, Math.max(1, Number.parseInt(search.page ?? "1", 10) || 1));
  const pageLink = (n: number) => `/progress/mistakes?${new URLSearchParams({ subject, topic, status: mastered ? "mastered" : "active", page: String(n) })}`;
  const revisionSubjects = [...new Map(filtered.map(m => [m.item.question.subject.slug, m.item.question.subject.name])).entries()];
  return <div className="mx-auto max-w-4xl space-y-5">
    <Link href="/progress" className="inline-flex min-h-11 items-center text-sm font-bold text-blue-700">← Progress</Link>
    <header><h1 className="text-3xl font-black">Your mistake bank</h1><p className="mt-2 text-sm leading-6 text-slate-600">Wrong and unanswered questions from completed attempts. Two consecutive correct answers in separate completed sessions mark a question as mastered. Missing it again returns it here.</p></header>
    <form className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2">
      <label className="text-sm font-bold">Subject<select name="subject" defaultValue={subject} className="mt-1 min-h-12 w-full rounded-xl border p-3"><option value="">All subjects</option>{subjects.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select></label>
      <label className="text-sm font-bold">Topic<select name="topic" defaultValue={topic} className="mt-1 min-h-12 w-full rounded-xl border p-3"><option value="">All topics</option>{topics.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select></label>
      <label className="text-sm font-bold">Status<select name="status" defaultValue={mastered ? "mastered" : "active"} className="mt-1 min-h-12 w-full rounded-xl border p-3"><option value="active">Needs review</option><option value="mastered">Mastered</option></select></label>
      <button className="min-h-12 self-end rounded-xl bg-slate-950 p-3 font-bold text-white">Apply filters</button>
    </form>
    <p className="font-semibold">{filtered.length} {mastered ? "mastered questions" : "questions to revisit"}</p>
    {!mastered && revisionSubjects.length > 0 && <section className="space-y-3 rounded-2xl bg-blue-50 p-4"><h2 className="font-bold">Practice my mistakes</h2><p className="text-sm text-slate-600">Choose a subject. Each session uses up to 20 of your saved mistakes.</p><div className="flex flex-wrap gap-2">{revisionSubjects.map(([slug, name]) => <RevisionButton key={slug} input={{ mistakes: true, subjectSlug: slug, ...(topic ? { topicSlug: topic } : {}) }}>{name}</RevisionButton>)}</div></section>}
    {!filtered.length && <p className="rounded-2xl border bg-white p-6">No questions match these filters. {bank.length ? "Try another subject or status." : "Complete a practice session or mock to start building your revision history."}</p>}
    {filtered.slice((page - 1) * 20, page * 20).map(m => <article key={m.key} className="rounded-2xl border bg-white p-5"><p className="text-xs font-bold text-blue-700">{m.item.question.subject.name} · {m.item.question.topic?.name ?? "Uncategorised"}</p><h2 className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7">{m.item.question.prompt}</h2><p className="mt-3 text-xs text-slate-600">{m.failures} missed attempts · Correct streak: {m.streak}{m.mastered ? " · Mastered" : " / 2"}</p><Link href={`/progress/results/${m.kind}/${m.resultId}#answer-review`} className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-blue-700">Review answer & explanation →</Link></article>)}
    {pages > 1 && <nav aria-label="Mistake pages" className="flex min-h-12 items-center justify-between">{page > 1 ? <Link href={pageLink(page - 1)}>← Previous</Link> : <span />}<span>{page} / {pages}</span>{page < pages ? <Link href={pageLink(page + 1)}>Next →</Link> : <span />}</nav>}
  </div>;
}
