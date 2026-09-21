"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CalendarRange, Clock3, Layers3, Lock, Sparkles } from "lucide-react";

import { AllowanceNotice } from "@/components/billing/allowance-notice";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { navClearance, typography } from "@/components/ui/variants";
import { PRACTICE_SESSION_IN_PROGRESS, practiceAvailableLine, practiceExhausted, resetLine } from "@/features/billing/copy";
import { asPlanLimitNotice, type PlanLimitNotice } from "@/features/billing/limit-notice";
import type { BillingTier } from "@/features/billing/plans";
import type { PracticeUsage } from "@/features/billing/usage-types";
import type { PracticeRecommendation } from "@/features/home/recommendation";
import { TIMED_SECONDS_PER_QUESTION } from "@/features/practice/types";
import type { PracticeCatalogSubject } from "@/features/questions/types";
import { cn } from "@/lib/utils";
import type { QuestionDifficulty } from "@/types/domain";

interface PracticeFilterCapabilities {
  years: boolean;
  topics: boolean;
  difficulty: boolean;
}

export type PracticeTab = "practice" | "past";

interface PracticeSetupProps {
  /** Which entry point is open. Mirrored in the URL as `?mode=past`. */
  tab: PracticeTab;
  examCode: string;
  examName: string;
  examYear: number;
  subjects: PracticeCatalogSubject[];
  /** The deployment default, used for a subject with no entry of its own. */
  capabilities: PracticeFilterCapabilities;
  /**
   * Filters each subject's own provider can honour.
   *
   * Providers are resolved per exam and subject, so one screen can hold two of
   * them: WAEC Mathematics comes from a source that filters by year, WAEC
   * Physics from one that (on the current plan) does not. Offering a single set
   * of controls would either hide a filter that works or advertise one that
   * does not — and an unhonourable filter fails session creation rather than
   * being silently dropped, so the control must not be shown at all.
   */
  subjectCapabilities?: Record<string, PracticeFilterCapabilities>;
  /** Slugs the resolved question source cannot serve. Never offered for selection. */
  unavailableSubjects: string[];
  /** Resolved server-side by the one shared recommendation engine. */
  recommendation: PracticeRecommendation;
  /** True for `?quick=1`: apply the recommendation on arrival, but never start. */
  prefillFromRecommendation: boolean;
  /** Used by the WAEC timed-subject entry point; never starts automatically. */
  initialMode?: PracticeMode;
  resumeSession?: {
    id: string;
    subjectName: string;
    mode: PracticeMode;
    answeredCount: number;
    questionCount: number;
  } | null;
  /**
   * The server's practice allowance: how many new sessions are left today, how
   * large a session this plan may build, and the session already running if
   * there is one.
   *
   * Displayed, and used to size and label the offer. It decides nothing: the
   * session route re-checks under the reservation lock and clamps whatever is
   * sent, so a tampered page can only ever be refused.
   */
  practiceUsage: PracticeUsage;
  /** From the server-resolved entitlement. Only Free sees allowance copy. */
  tier: BillingTier;
}

type PracticeMode = "practice" | "timed";

const QUESTION_COUNTS = [10, 20, 30, 40] as const;
const DEFAULT_COUNT = 20;

/**
 * The session sizes this plan may choose from.
 *
 * Never larger than the plan's ceiling, so a Free student is offered 10 and 20
 * rather than being shown 30 and 40 and refused — or, worse, silently given
 * fewer questions than the button they pressed. Master is offered all four.
 *
 * The ceiling is always included even if it is not one of the standard sizes,
 * so a plan can never lose the ability to build its own largest session.
 */
export function allowedQuestionCounts(maxQuestionsPerSession: number): number[] {
  const ceiling = Math.max(1, Math.floor(maxQuestionsPerSession));
  const sizes: number[] = QUESTION_COUNTS.filter((count) => count <= ceiling);
  if (!sizes.includes(ceiling)) sizes.push(ceiling);
  return [...new Set(sizes)].sort((a, b) => a - b);
}

const UNAVAILABLE_EXPLANATION =
  "Not available yet — this subject is not in our current question source. It returns automatically once ready.";

/**
 * What the chosen mode actually does, in the student's terms: how many
 * questions, how long, and when they find out whether they were right.
 *
 * The time limit is derived from `TIMED_SECONDS_PER_QUESTION` — the same rule
 * the server applies when it creates the session — so the promise on this
 * screen cannot drift from the timer the student then gets.
 */
export function practiceModeSummary(mode: PracticeMode, questionCount: number) {
  if (mode === "timed") {
    const minutes = Math.round((questionCount * TIMED_SECONDS_PER_QUESTION) / 60);
    return {
      label: "Timed",
      detail: `${questionCount} questions in ${minutes} minutes. Answers are not marked as you go — you see every correct answer and explanation when the session ends or time runs out.`,
    };
  }

  return {
    label: "Practice",
    detail: `${questionCount} questions, no time limit. Each answer is marked immediately, with the explanation.`,
  };
}

export function PracticeSetup({
  tab,
  examCode,
  examName,
  examYear,
  subjects,
  capabilities: defaultCapabilities,
  subjectCapabilities,
  unavailableSubjects,
  recommendation,
  prefillFromRecommendation,
  initialMode = "practice",
  resumeSession,
  practiceUsage,
  tier,
}: PracticeSetupProps) {
  const isFree = tier === "free";
  const ceiling = practiceUsage.maxQuestionsPerSession;
  const countOptions = allowedQuestionCounts(ceiling);
  const sizeFor = (count: number) => Math.max(1, Math.min(count, ceiling));
  /*
   * No new session may be started. Either today's is still running — in which
   * case the student is sent back to it — or it is finished, and Master is what
   * changes that. A null count is an unreadable ledger, never a refusal.
   */
  const sessionsLeft = practiceUsage.remaining;
  const blockedByAllowance = sessionsLeft !== null && sessionsLeft < 1;
  const router = useRouter();
  const unavailable = useMemo(() => new Set(unavailableSubjects), [unavailableSubjects]);
  const availableSubjects = useMemo(
    () => subjects.filter((subject) => !unavailable.has(subject.slug)),
    [subjects, unavailable],
  );

  /** What the provider behind one subject can filter by. */
  const capabilitiesFor = useCallback(
    (slug: string | undefined) => (slug && subjectCapabilities?.[slug]) || defaultCapabilities,
    [subjectCapabilities, defaultCapabilities],
  );

  /**
   * The recommendation is only usable if the provider can still serve it — a
   * subject can drop out of the catalogue between the attempt and now, and a
   * topic means nothing when the provider cannot filter by one.
   */
  const prefill = useMemo(() => {
    if (recommendation.kind === "start") return null;
    const subject = availableSubjects.find((item) => item.slug === recommendation.subjectSlug);
    if (!subject) return null;

    // The recommended subject's own provider decides, not the screen's default.
    if (recommendation.kind === "topic" && capabilitiesFor(subject.slug).topics) {
      const topic = subject.topics.find((item) => item.slug === recommendation.topicSlug);
      if (topic) return { subject, topicSlug: topic.slug, label: recommendation.topicName };
    }

    // Falls back to the whole subject: a topic the provider cannot filter by,
    // or one no longer in the catalogue, must not become a silent no-op filter.
    return { subject, topicSlug: "all", label: subject.name };
  }, [recommendation, availableSubjects, capabilitiesFor]);

  const [subjectSlug, setSubjectSlug] = useState(
    () => (prefillFromRecommendation ? prefill?.subject.slug : undefined) ?? availableSubjects[0]?.slug ?? "",
  );
  const activeSubject = useMemo(
    () => availableSubjects.find((subject) => subject.slug === subjectSlug) ?? availableSubjects[0],
    [subjectSlug, availableSubjects],
  );
  /** Every control below follows the selected subject's provider. */
  const capabilities = capabilitiesFor(activeSubject?.slug);
  const [topicSlug, setTopicSlug] = useState(
    () => (prefillFromRecommendation ? prefill?.topicSlug : undefined) ?? "all",
  );
  const [chosenCount, setQuestionCount] = useState<number>(() => sizeFor(DEFAULT_COUNT));
  // Never offer, label or send a session larger than the plan may build.
  const questionCount = sizeFor(chosenCount);
  const [mode, setMode] = useState<PracticeMode>(initialMode);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | "mixed">("mixed");
  const [year, setYear] = useState("all");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [planLimit, setPlanLimit] = useState<PlanLimitNotice | null>(null);

  const isPast = tab === "past";

  const chooseSubject = (slug: string) => {
    if (unavailable.has(slug)) return;
    setSubjectSlug(slug);
    // Every filter belongs to the subject it was chosen for. Two subjects on
    // this screen can have different providers, so carrying a year or a
    // difficulty across would leave a selection visible that the new subject's
    // source cannot honour — and it would then be dropped on the way to the
    // server, which is exactly the silent relaxation this product forbids.
    setTopicSlug("all");
    setYear("all");
    setDifficulty("mixed");
  };

  const applyRecommendation = () => {
    if (!prefill) return;
    setSubjectSlug(prefill.subject.slug);
    setTopicSlug(prefill.topicSlug);
    setQuestionCount(sizeFor(DEFAULT_COUNT));
    setMode("practice");
  };

  const startSession = async () => {
    if (!activeSubject || starting || blockedByAllowance) return;
    setStarting(true);
    setStartError(null);
    setPlanLimit(null);

    try {
      const response = await fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examBody: examCode,
          subjectSlug: activeSubject.slug,
          // Unsupported filters are never sent, on either tab.
          topicSlug: !isPast && capabilities.topics && topicSlug !== "all" ? topicSlug : null,
          count: questionCount,
          mode,
          difficulty: !isPast && capabilities.difficulty && difficulty !== "mixed" ? difficulty : null,
          year: isPast && capabilities.years && year !== "all" ? Number(year) : null,
        }),
      });
      const payload = (await response.json()) as { sessionId?: string; questionCount?: number; requestedCount?: number; error?: string };
      if (!response.ok || !payload.sessionId) {
        /*
         * Reaching the daily allowance is not an error the student caused. It
         * gets the upgrade panel — what ran out, when it resets, what Master
         * changes — rather than a red failure band.
         */
        const notice = asPlanLimitNotice(payload);
        if (notice) {
          setPlanLimit(notice);
          setStarting(false);
          return;
        }
        throw new Error(payload.error || "Could not start practice.");
      }
      router.push(`/practice/session/${payload.sessionId}`);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start practice.");
      setStarting(false);
    }
  };

  if (!activeSubject) {
    return (
      <div className="mx-auto max-w-[640px] rounded-2xl border border-slate-200 bg-white p-6 text-[13.5px] leading-[1.6] text-slate-600">
        {subjects.length
          ? "None of your subjects can be practised right now while we expand the question source. Please check back shortly."
          : "No subjects are configured for your current exam preference."}
      </div>
    );
  }

  const years = Array.from({ length: 10 }, (_, index) => examYear - index);

  return (
    <div className="screen-enter mx-auto max-w-[640px] space-y-3.5">
      <div>
        <div className={cn(typography.eyebrow, "text-brand-500")}>{isPast ? "Past questions" : "Practice"}</div>
        <h1 className={cn("mt-1.5", typography.h1)}>{isPast ? "Practise by exam year" : "Build a focused session"}</h1>
        <p className="mt-1 text-[13px] leading-[1.5] text-slate-600">
          {isPast
            ? `${examName} questions grouped by the year they were set.`
            : `${examName} ${examYear} · choose what you want to work on.`}
        </p>
      </div>

      {/*
        Switching tab is a real navigation — the URL is the state, so back and
        forward behave and a link can open either view directly. That makes this
        a navigation landmark rather than an ARIA tablist.
      */}
      <nav aria-label="Practice mode" className="flex gap-0.5 rounded-xl bg-slate-100 p-[3px]">
        {[
          { key: "practice" as const, href: "/practice", label: "Practice" },
          { key: "past" as const, href: "/practice?mode=past", label: "Past questions" },
        ].map(({ key, href, label }) => (
          <Link
            key={key}
            href={href}
            scroll={false}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "flex h-[38px] flex-1 items-center justify-center rounded-lg text-[12.5px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
              tab === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {isFree ? <FreePracticeStatus usage={practiceUsage} /> : null}

      {resumeSession ? (
        <button
          type="button"
          onClick={() => router.push(`/practice/session/${resumeSession.id}`)}
          className="w-full rounded-2xl border border-brand-200 bg-brand-50 p-[18px] text-left transition hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <div className={cn(typography.eyebrow, "text-brand-500")}>Resume session</div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[13px] font-bold text-slate-950">{resumeSession.subjectName} · <span className="capitalize">{resumeSession.mode}</span></div>
              <div className="mt-1 text-xs text-slate-600">{resumeSession.answeredCount} of {resumeSession.questionCount} answers saved</div>
            </div>
            <span className="shrink-0 text-xs font-bold text-brand-500">Continue →</span>
          </div>
        </button>
      ) : null}

      {!isPast ? <QuickPracticeCard prefill={prefill} recommendation={recommendation} onApply={applyRecommendation} /> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-[18px]">
        <h2 className={typography.h2}>Subject</h2>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {subjects.map((subject) => {
            const isUnavailable = unavailable.has(subject.slug);
            const active = !isUnavailable && subject.slug === activeSubject.slug;
            return (
              <button
                type="button"
                key={subject.id}
                disabled={isUnavailable}
                aria-pressed={isUnavailable ? undefined : active}
                onClick={() => chooseSubject(subject.slug)}
                className={cn(
                  "min-h-11 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                  isUnavailable
                    ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400"
                    : active
                      ? "border-[1.5px] border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-800 hover:border-slate-300",
                )}
              >
                {subject.name}
                {isUnavailable ? (
                  <>
                    <Badge tone="neutral" className="mt-1 flex justify-center">Not available yet</Badge>
                    {/* The badge is a label; the reason belongs in the button's own name. */}
                    <span className="sr-only">{UNAVAILABLE_EXPLANATION}</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
        {unavailable.size ? (
          <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-5 text-slate-500">
            <Lock aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Some subjects are temporarily unavailable while we expand the question source. They return automatically once ready.</span>
          </p>
        ) : null}
      </section>

      {isPast ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-[18px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className={typography.h2}>Exam year</h2>
              <p className="mt-1 text-[11.5px] text-slate-500">
                {capabilities.years
                  ? "Pick one year, or mix every year we can reach."
                  : "Year filtering is not available from the current question source."}
              </p>
            </div>
            <CalendarRange aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" />
          </div>
          {capabilities.years ? (
            <>
              <label htmlFor="practice-year" className="sr-only">Exam year</label>
              <Select
                id="practice-year"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                containerClassName="mt-2.5"
              >
                <option value="all">All years</option>
                {years.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </>
          ) : null}
        </section>
      ) : capabilities.topics ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-[18px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className={typography.h2}>Topic</h2>
              <p className="mt-1 text-[11.5px] text-slate-500">Focus on one area, or mix the whole subject.</p>
            </div>
            <Layers3 aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" />
          </div>
          <label htmlFor="practice-topic" className="sr-only">Topic</label>
          <Select
            id="practice-topic"
            value={topicSlug}
            onChange={(event) => setTopicSlug(event.target.value)}
            containerClassName="mt-2.5"
          >
            <option value="all">All topics</option>
            {activeSubject.topics.map((topic) => (
              <option key={topic.id} value={topic.slug}>{topic.name}</option>
            ))}
          </Select>
        </section>
      ) : (
        /* No hidden control: the capability is absent, so the reason is shown instead. */
        <section className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-[18px]">
          <Layers3 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <div>
            <h2 className={typography.h2}>Whole-subject practice</h2>
            <p className="mt-1 text-[11.5px] leading-5 text-slate-500">
              Your session covers the full subject. Topic filtering will be available with an expanded question source.
            </p>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-[18px]">
        <div className="grid grid-cols-2 gap-5">
          <div>
            <h2 className={typography.h2} id="practice-count-label">Questions</h2>
            {isFree ? (
              <p id="practice-count-note" className="mt-1 text-[11px] leading-4 text-slate-500">
                Free plan: up to {ceiling} questions in a session
              </p>
            ) : null}
            <div
              className="mt-2.5 flex gap-1.5"
              role="group"
              aria-labelledby="practice-count-label"
              aria-describedby={isFree ? "practice-count-note" : undefined}
            >
              {countOptions.map((count) => (
                <button
                  type="button"
                  key={count}
                  aria-pressed={questionCount === count}
                  onClick={() => setQuestionCount(count)}
                  className={cn(
                    "h-10 min-w-0 flex-1 rounded-lg border text-[12.5px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                    questionCount === count
                      ? "border-[1.5px] border-brand-500 bg-brand-50 text-brand-500"
                      : "border-slate-200 text-slate-600 hover:border-slate-300",
                  )}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h2 className={typography.h2} id="practice-mode-label">Mode</h2>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5" role="group" aria-labelledby="practice-mode-label">
              {(["practice", "timed"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "h-10 rounded-lg border text-[12.5px] font-bold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                    mode === value
                      ? "border-[1.5px] border-brand-500 bg-brand-50 text-brand-500"
                      : "border-slate-200 text-slate-600 hover:border-slate-300",
                  )}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/*
          What the chosen mode actually does, before the student commits. The
          time limit is derived from the server's own rule, not restated.
        */}
        <p aria-live="polite" className="mt-4 border-t border-slate-100 pt-3.5 text-xs leading-[1.6] text-slate-600">
          <strong className="font-bold text-slate-950">{practiceModeSummary(mode, questionCount).label}:</strong>{" "}
          {practiceModeSummary(mode, questionCount).detail}
        </p>

        {!isPast && capabilities.difficulty ? (
          <div className="mt-4 border-t border-slate-100 pt-3.5">
            <label htmlFor="practice-difficulty" className={cn("block", typography.h2)}>Difficulty</label>
            <Select
              id="practice-difficulty"
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as QuestionDifficulty | "mixed")}
              containerClassName="mt-3"
            >
              <option value="mixed">Mixed</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </div>
        ) : null}
      </section>

      <div
        className={cn(
          "sticky z-10 rounded-2xl border border-slate-200 bg-white/[0.97] p-3 shadow-soft backdrop-blur lg:static lg:mt-2 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none",
          // Shared tab-bar clearance, so this can never drift from the 68px bar again.
          navClearance.bottom,
        )}
      >
        {planLimit ? <div className="mb-3"><UpgradePrompt notice={planLimit} /></div> : null}
        {startError ? <div className="mb-3"><InlineAlert tone="danger">{startError}</InlineAlert></div> : null}
        <Button
          type="button"
          variant="primary"
          size="xl"
          fullWidth
          onClick={startSession}
          disabled={blockedByAllowance}
          loading={starting}
          loadingLabel="Building session…"
          iconBefore={<Clock3 className="h-4 w-4" aria-hidden="true" />}
        >
          {!blockedByAllowance
            ? `Start ${questionCount}-question session`
            : practiceUsage.activeSession
              ? "Today’s session is already in progress"
              // "free" belongs only to the Free plan. A Master student who has
              // somehow reached their own daily limit is told the truth about
              // theirs, not sold a plan they already have.
              : isFree
                ? "Today’s free practice session has been used"
                : "You’ve started every practice session for today"}
        </Button>
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Your question set is frozen when the session starts, so refreshes and resumes stay consistent.
        </p>
      </div>
    </div>
  );
}

/**
 * Where a Free student stands before they build anything.
 *
 * The counts are the server's. Three states, and the difference between them is
 * the whole point:
 *
 *   - a session is available    → say so, and let them build it;
 *   - today's is still running  → send them back to it, with Master beside it,
 *                                 never instead of it. Nothing has been lost;
 *   - today's is finished       → say that plainly, and say what Master changes.
 *
 * Only the third is a dead end, and only the third leads with an upgrade.
 */
function FreePracticeStatus({ usage }: { usage: PracticeUsage }) {
  const { remaining, limit, activeSession } = usage;

  if (remaining === null) {
    return (
      <InlineAlert tone="warning" role="status">
        We couldn’t check today’s free practice session just now. Try again in a moment.
      </InlineAlert>
    );
  }

  const exhausted = practiceExhausted(limit);
  return (
    <div className="space-y-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[12.5px] text-slate-700">
        <Badge tone="neutral">Free plan</Badge>
        <span className="font-semibold text-slate-950">
          {remaining > 0
            ? practiceAvailableLine(remaining)
            : activeSession
              ? "Today’s practice session is already in progress"
              : "Today’s free practice session has been used"}
        </span>
        <span className="text-slate-500">· {resetLine(usage.resetAt, "day")}</span>
      </p>

      {remaining > 0 ? (
        <p className="text-[11.5px] leading-4 text-slate-500">
          Up to {usage.maxQuestionsPerSession} questions. You can leave and come back to it — only starting a new
          session uses today’s.
        </p>
      ) : activeSession ? (
        /*
         * The way back in, not a wall.
         *
         * The resume card above this is scoped to the exam the student is
         * looking at, and the allowance is not: a student preparing for JAMB and
         * WAEC can be told "already in progress" on a screen whose own resume
         * card is empty. This link is the session the *allowance* is holding,
         * whichever exam it belongs to, so "in progress" is never a dead end.
         */
        <div className="space-y-2">
          <Link
            href={`/practice/session/${activeSession.id}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 transition hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-slate-950">Resume {activeSession.subjectName}</span>
              <span className="mt-0.5 block text-[11.5px] text-slate-600">
                {activeSession.answeredCount} of {activeSession.questionCount} answered · resuming never uses another session
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-xs font-bold text-brand-500">Continue →</span>
          </Link>
          <AllowanceNotice
            emphasis="subtle"
            message={PRACTICE_SESSION_IN_PROGRESS.message}
            upgrade={PRACTICE_SESSION_IN_PROGRESS.upgrade}
            source="practice_session_in_progress"
          />
        </div>
      ) : (
        <AllowanceNotice
          message={exhausted.message}
          upgrade={exhausted.upgrade}
          source="practice_exhausted"
          detail="Your results, answers and mistake bank stay available."
        />
      )}
    </div>
  );
}

/**
 * The quick-practice shortcut. What it offers comes entirely from the shared
 * server-side recommendation — when there is nothing to recommend, or the
 * provider can no longer serve it, it says so instead of guessing a subject.
 */
function QuickPracticeCard({
  prefill,
  recommendation,
  onApply,
}: {
  prefill: { label: string } | null;
  recommendation: PracticeRecommendation;
  onApply: () => void;
}) {
  if (!prefill || recommendation.kind === "start") {
    return (
      <section className="rounded-2xl bg-slate-950 p-[18px] text-white">
        <h2 className={cn(typography.eyebrow, "flex items-center gap-2 text-white/55")}>
          <Sparkles aria-hidden="true" className="h-4 w-4" /> Quick practice
        </h2>
        <p className="mt-2 font-serif text-base font-semibold">Start a practice session</p>
        <p className="mt-1.5 text-xs leading-[1.5] text-white/60">
          {recommendation.kind === "start" && recommendation.hasHistory
            ? "Nothing is falling behind right now. Choose any subject below and set your own session."
            : "Choose a subject below. Once you finish a session, this shortcut targets whatever needs the most work."}
        </p>
      </section>
    );
  }

  return (
    <button
      type="button"
      onClick={onApply}
      className="w-full rounded-2xl bg-slate-950 p-[18px] text-left text-white transition hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
    >
      <span className={cn(typography.eyebrow, "flex items-center gap-2 text-white/55")}>
        <Sparkles aria-hidden="true" className="h-4 w-4" /> Quick practice
      </span>
      <span className="mt-2 block font-serif text-base font-semibold">{prefill.label}</span>
      <span className="mt-1.5 block text-xs leading-[1.5] text-white/60">
        {recommendation.correct} of {recommendation.total} correct ({recommendation.accuracy}%) in your latest attempt ·
        tap to set up {DEFAULT_COUNT} questions
      </span>
    </button>
  );
}
