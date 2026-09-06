import Link from "next/link";
import { requireOnboardedUser } from "@/lib/auth";
import { loadHistory } from "@/features/results/service";
import { mistakeBank } from "@/features/results/grading";
export const dynamic = "force-dynamic";
export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { user } = await requireOnboardedUser();
  const history = await loadHistory(user.id);
  const bank = mistakeBank(history);
  const active = bank.filter(m => !m.mastered).length;
  const search = await searchParams;
  const pages = Math.max(1, Math.ceil(history.length / 10));
  const page = Math.min(pages, Math.max(1, Number.parseInt(search.page ?? "1", 10) || 1));
  const mocks = history.filter(r => r.scaled).slice(0, 5).reverse();
  return <div className="mx-auto max-w-4xl space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-blue-700">Progress</p><h1 className="mt-2 text-3xl font-black">Learn from every attempt.</h1><p className="mt-2 text-sm text-slate-600">Your completed mocks, practice results and revision history.</p></header>
    <Link href="/progress/mistakes" className="block rounded-2xl bg-slate-950 p-5 text-white"><p className="text-2xl font-bold">{active} mistakes to revisit</p><p className="mt-2 text-sm text-blue-200">{bank.filter(m => m.mastered).length} mastered · Open mistake bank →</p></Link>
    {mocks.length > 0 && <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Recent mock scores</h2><p className="mt-2 text-sm text-slate-600">Oldest to newest · Estimated scores out of 400. Subject combinations may differ.</p><ol className="mt-3 flex flex-wrap gap-3">{mocks.map(r => <li key={r.id}><Link className="inline-flex min-h-12 items-center rounded-xl bg-blue-50 px-4 font-bold text-blue-800" href={`/progress/results/exam/${r.id}`}>{r.score}/400</Link></li>)}</ol></section>}
    <section className="space-y-3"><h2 className="text-xl font-bold">Results</h2>{history.length === 0 ? <div className="rounded-2xl border bg-white p-6"><p>No completed attempts yet. Finish a practice session or mock to see your results here.</p><Link href="/practice" className="mt-3 inline-flex min-h-12 items-center font-bold text-blue-700">Start practice →</Link></div> : history.slice((page - 1) * 10, page * 10).map(r => <Link key={`${r.kind}:${r.id}`} href={`/progress/results/${r.kind}/${r.id}`} className="block rounded-2xl border bg-white p-5 hover:border-blue-400"><div className="flex items-start justify-between gap-4"><h3 className="font-bold">{r.title}</h3><p className="shrink-0 text-xl font-black">{r.score}/{r.maximum}</p></div><p className="mt-2 text-sm text-slate-600">{new Date(r.completedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })} · {r.correct}/{r.total} correct</p><p className="mt-3 text-sm font-bold text-blue-700">Breakdown & answer review →</p></Link>)}</section>
    {pages > 1 && <nav aria-label="Result pages" className="flex min-h-12 items-center justify-between gap-3">{page > 1 ? <Link href={`/progress?page=${page - 1}`}>← Previous</Link> : <span />}<span>{page} / {pages}</span>{page < pages ? <Link href={`/progress?page=${page + 1}`}>Next →</Link> : <span />}</nav>}
  </div>;
}
