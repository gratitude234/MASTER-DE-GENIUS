import Link from "next/link";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { SubjectPerformance } from "@/components/home/subject-performance";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroPanel } from "@/components/ui/hero-panel";
import { buttonClasses, typography } from "@/components/ui/variants";
import { summariseProgress } from "@/features/progress/summary";
import { mistakeBank } from "@/features/results/grading";
import { loadHistory } from "@/features/results/service";
import { requireOnboardedUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

const cardLink =
  "block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-500/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none";
const inlineLink =
  "inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-extrabold text-brand-600 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { user } = await requireOnboardedUser();
  const history = await loadHistory(user.id);
  const bank = mistakeBank(history);
  const active = bank.filter(m => !m.mastered).length;
  const mastered = bank.filter(m => m.mastered).length;
  const search = await searchParams;
  const pages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(search.page ?? "1", 10) || 1));
  const mocks = history.filter(r => r.scaled).slice(0, 5).reverse();

  // Counting only, over results that are already graded and already loaded.
  const summary = summariseProgress(history);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className={cn(typography.eyebrow, "text-brand-600")}>Progress</p>
        <h1 className={cn("mt-2", typography.h1)}>Learn from every attempt.</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Your completed mocks, practice results and revision history.</p>
      </header>

      <HeroPanel
        eyebrow="Mistake bank"
        action={
          <Link href="/progress/mistakes" className={buttonClasses({ variant: "primary", size: "lg", className: "w-full focus-visible:ring-white focus-visible:ring-offset-slate-950 lg:w-auto" })}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Open mistake bank
          </Link>
        }
      >
        <h2 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
          {active} {active === 1 ? "mistake" : "mistakes"} to revisit
        </h2>
        <p className="mt-2 text-sm text-white/70">
          {mastered} mastered · a question is mastered after two correct answers in separate completed sessions.
        </p>
      </HeroPanel>

      {summary.attempts > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className={typography.h2}>Overall</h2>
          <dl className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: summary.attempts === 1 ? "Attempt" : "Attempts", value: summary.attempts },
              { label: "Questions answered", value: summary.questions },
              { label: "Correct overall", value: `${summary.accuracy}%` },
            ].map(({ label, value }) => (
              // Reversed for layout only: the term still precedes its value in
              // the DOM, so the pair reads correctly to assistive technology.
              <div key={label} className="flex flex-col-reverse rounded-xl bg-slate-50 p-3 text-center">
                <dt className="mt-1 text-[11px] font-medium leading-4 text-slate-500">{label}</dt>
                <dd className="mono-number text-xl font-black leading-none text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {/*
        The Performance destination. `id` makes /progress#performance a real
        place to land, and `scroll-mt` keeps the heading clear of the sticky
        chrome when it does.
      */}
      <section id="performance" className="scroll-mt-6">
        {summary.subjects.length > 0 ? (
          <SubjectPerformance
            caption="All attempts"
            subjects={summary.subjects.map(subject => ({
              name: subject.name,
              accuracy: subject.accuracy,
              correct: subject.correct,
              total: subject.total,
            }))}
          />
        ) : (
          <EmptyState
            headingLevel={2}
            title="Subject performance"
            description="Once you complete a practice session or a mock, your accuracy in each subject appears here."
          />
        )}
      </section>

      {mocks.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className={typography.h2}>Recent mock scores</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Oldest to newest · Estimated scores out of 400. Subject combinations may differ.</p>
          <ol className="mt-3 flex flex-wrap gap-2">
            {mocks.map(r => (
              <li key={r.id}>
                <Link
                  className={buttonClasses({ variant: "secondary", size: "md", className: "mono-number border-brand-500/20 bg-brand-50 text-brand-600 hover:bg-brand-50" })}
                  href={`/progress/results/exam/${r.id}`}
                >
                  {r.score}/400
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className={typography.h2}>Results</h2>
        {history.length === 0 ? (
          <EmptyState
            title="No completed attempts yet"
            description="Finish a practice session or a mock and every attempt will be listed here, with its full breakdown and answer review."
            action={<Link href="/practice" className={buttonClasses({ variant: "dark", size: "lg" })}>Start practice</Link>}
          />
        ) : (
          history.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(r => (
            <Link key={`${r.kind}:${r.id}`} href={`/progress/results/${r.kind}/${r.id}`} className={cardLink}>
              <div className="flex items-start justify-between gap-4">
                <h3 className={typography.h2}>{r.title}</h3>
                <p className="mono-number shrink-0 text-xl font-black leading-none text-slate-950">{r.score}/{r.maximum}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={r.scaled ? "brand" : "neutral"}>{r.scaled ? "Mock · scaled" : "Practice"}</Badge>
                <span className="text-sm text-slate-500">
                  {dateFormatter.format(new Date(r.completedAt))} · {r.correct}/{r.total} correct
                </span>
              </div>
              <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-extrabold text-brand-600">
                Breakdown &amp; answer review <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </p>
            </Link>
          ))
        )}
      </section>

      {pages > 1 ? (
        <nav aria-label="Result pages" className="flex min-h-12 items-center justify-between gap-3">
          {page > 1 ? <Link href={`/progress?page=${page - 1}`} className={inlineLink}>← Previous</Link> : <span />}
          <span className="mono-number text-sm font-semibold text-slate-500">{page} / {pages}</span>
          {page < pages ? <Link href={`/progress?page=${page + 1}`} className={inlineLink}>Next →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
