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
  "block rounded-2xl border border-slate-200 bg-white p-[18px] transition hover:border-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none";
const inlineLink =
  "inline-flex min-h-11 items-center gap-1.5 rounded text-[12.5px] font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

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
    <div className="screen-enter mx-auto max-w-[760px] space-y-4">
      <header>
        <p className={cn(typography.eyebrow, "text-brand-500")}>Progress</p>
        <h1 className={cn("mt-1.5", typography.h1)}>Learn from every attempt.</h1>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-slate-600">Your completed mocks, practice results and revision history.</p>
      </header>

      <HeroPanel
        eyebrow="Mistake bank"
        action={
          <Link href="/progress/mistakes" className={buttonClasses({ variant: "secondary", size: "md", className: "w-full border-0 bg-white text-slate-950 hover:bg-slate-100 focus-visible:ring-white focus-visible:ring-offset-slate-950 lg:w-auto" })}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Open mistake bank
          </Link>
        }
      >
        <h2 className="mt-2 font-serif text-xl font-semibold tracking-[-0.01em]">
          {active} {active === 1 ? "mistake" : "mistakes"} to revisit
        </h2>
        <p className="mt-2 max-w-[420px] text-[13px] leading-[1.5] text-white/65">
          {mastered} mastered · a question is mastered after two correct answers in separate completed sessions.
        </p>
      </HeroPanel>

      {summary.attempts > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-[18px]">
          <h2 className={typography.h2}>Overall</h2>
          <dl className="mt-3.5 grid grid-cols-3 gap-2.5">
            {[
              { label: summary.attempts === 1 ? "Attempt" : "Attempts", value: summary.attempts },
              { label: "Questions answered", value: summary.questions },
              { label: "Correct overall", value: `${summary.accuracy}%` },
            ].map(({ label, value }) => (
              // Reversed for layout only: the term still precedes its value in
              // the DOM, so the pair reads correctly to assistive technology.
              <div key={label} className="flex flex-col-reverse rounded-xl bg-slate-50 p-3 text-center">
                <dt className="mt-1 text-[10.5px] font-medium leading-4 text-slate-500">{label}</dt>
                <dd className="mono-number text-xl font-semibold leading-none text-slate-950">{value}</dd>
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
        <section className="rounded-2xl border border-slate-200 bg-white p-[18px]">
          <h2 className={typography.h2}>Recent mock scores</h2>
          <p className="mt-1 text-[11px] text-slate-500">Oldest to newest · estimated out of 400. Subject combinations may differ.</p>
          <ol className="mt-3 flex flex-wrap gap-2">
            {mocks.map(r => (
              <li key={r.id}>
                <Link
                  className={buttonClasses({ variant: "secondary", size: "sm", className: "mono-number h-9 border-brand-200 bg-brand-50 text-[12.5px] font-bold text-brand-500 hover:bg-brand-100" })}
                  href={`/progress/results/exam/${r.id}`}
                >
                  {r.score}/400
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="space-y-2.5">
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
                <p className="mono-number shrink-0 text-xl font-semibold leading-none text-slate-950">{r.score}/{r.maximum}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={r.scaled ? "brand" : "neutral"}>{r.scaled ? "Mock · scaled" : "Practice"}</Badge>
                <span className="text-[11.5px] text-slate-500">
                  {dateFormatter.format(new Date(r.completedAt))} · {r.correct}/{r.total} correct
                </span>
              </div>
              <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-brand-500">
                Breakdown &amp; answer review <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </p>
            </Link>
          ))
        )}
      </section>

      {pages > 1 ? (
        <nav aria-label="Result pages" className="flex min-h-12 items-center justify-between gap-3">
          {page > 1 ? <Link href={`/progress?page=${page - 1}`} className={inlineLink}>← Previous</Link> : <span />}
          <span className="mono-number text-[12.5px] font-semibold text-slate-500">{page} / {pages}</span>
          {page < pages ? <Link href={`/progress?page=${page + 1}`} className={inlineLink}>Next →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
