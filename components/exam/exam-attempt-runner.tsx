"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Grid3X3,
  LogOut,
  Send,
  Wifi,
  WifiOff,
} from "lucide-react";

import { BrandMark } from "@/components/brand/brand-mark";
import type {
  ExamAttemptView,
  SubmitExamAttemptResult,
} from "@/features/exams/types";
import type { QuestionOption } from "@/types/domain";

import { useOfflineSession } from "@/features/offline/use-session";
import { SessionStatus } from "@/components/pwa/session-status";
import { SyncNotice } from "@/components/pwa/sync-notice";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Sheet } from "@/components/ui/sheet";
import { typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

interface ExamAttemptRunnerProps {
  recovered?: boolean;
  initialAttempt: ExamAttemptView;
}

interface LocalResponse {
  selectedOptionKey: QuestionOption["key"] | null;
  isFlagged: boolean;
}

/** The two low-time bands this screen already treated differently. */
const TIMER_WARNING_SECONDS = 600;
const TIMER_DANGER_SECONDS = 300;

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function submittedFromAttempt(attempt: ExamAttemptView): SubmitExamAttemptResult | null {
  if (attempt.status !== "submitted" || !attempt.submittedAt || !attempt.submissionReason) return null;
  return {
    attemptId: attempt.id,
    status: "submitted",
    answeredCount: attempt.answeredCount,
    flaggedCount: attempt.flaggedCount,
    totalQuestions: attempt.totalQuestions,
    submittedAt: attempt.submittedAt,
    submissionReason: attempt.submissionReason,
  };
}

/**
 * Announces the clock only when it crosses a band the UI already renders
 * differently. Per-second announcements would bury the question itself, and the
 * visible timer stays readable on demand through `role="timer"`.
 */
function useTimerAnnouncement(secondsLeft: number) {
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef<string | null>(null);

  const band =
    secondsLeft === 0
      ? "expired"
      : secondsLeft <= TIMER_DANGER_SECONDS
        ? "danger"
        : secondsLeft <= TIMER_WARNING_SECONDS
          ? "warning"
          : "normal";

  useEffect(() => {
    const last = previous.current;
    previous.current = band;
    if (last === null || last === band) return;
    if (band === "warning") setAnnouncement("Ten minutes remaining.");
    else if (band === "danger") setAnnouncement("Five minutes remaining.");
    else if (band === "expired") setAnnouncement("Time is up. Your paper is being submitted.");
    else setAnnouncement("");
  }, [band]);

  return announcement;
}

export function ExamAttemptRunner({ initialAttempt, recovered = false }: ExamAttemptRunnerProps) {
  const router = useRouter();
  const sync = useOfflineSession("exam", initialAttempt, recovered);
  const { answers: responses, state: saveState, online, finishing: submitting } = sync;
  const submitted = sync.receipt as unknown as SubmitExamAttemptResult | null ?? submittedFromAttempt(initialAttempt);
  const secondsLeft = sync.secondsLeft ?? 0;
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [passageOpen, setPassageOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const timerAnnouncement = useTimerAnnouncement(secondsLeft);
  const currentSubjectIndex = Math.min(sync.cursor.subject, initialAttempt.subjects.length - 1);
  const queueResponse = (id: string, next: LocalResponse) => { void sync.select(id, next); };
  const subjectStats = useMemo(() => initialAttempt.subjects.map((subject) => {
    let answered = 0;
    let flagged = 0;
    for (const question of subject.questions) {
      const state = responses[question.id];
      if (state?.selectedOptionKey) answered += 1;
      if (state?.isFlagged) flagged += 1;
    }
    return { subjectId: subject.id, answered, flagged, total: subject.questionCount };
  }), [initialAttempt.subjects, responses]);

  const answeredTotal = subjectStats.reduce((sum, item) => sum + item.answered, 0);
  const flaggedTotal = subjectStats.reduce((sum, item) => sum + item.flagged, 0);
  const unansweredTotal = initialAttempt.totalQuestions - answeredTotal;

  const currentSubject = initialAttempt.subjects[currentSubjectIndex] ?? initialAttempt.subjects[0];
  const currentQuestionIndex = currentSubject ? Math.min(sync.cursor.question, Math.max(0, currentSubject.questions.length - 1)) : 0;
  const currentQuestion = currentSubject?.questions[currentQuestionIndex];
  const currentResponse = currentQuestion ? responses[currentQuestion.id] : null;

  const jumpTo = (subjectIndex: number, questionIndex: number) => {
    const subject = initialAttempt.subjects[subjectIndex];
    if (!subject) return;
    sync.setCursor({ subject: subjectIndex, question: questionIndex });
    setNavigatorOpen(false);
    setSubmissionOpen(false);
    setPassageOpen(false);
  };

  const findFirst = (predicate: (response: LocalResponse) => boolean) => {
    for (let sIndex = 0; sIndex < initialAttempt.subjects.length; sIndex += 1) {
      const subject = initialAttempt.subjects[sIndex];
      for (let qIndex = 0; qIndex < subject.questions.length; qIndex += 1) {
        const question = subject.questions[qIndex];
        const state = responses[question.id] ?? { selectedOptionKey: null, isFlagged: false };
        if (predicate(state)) return { sIndex, qIndex };
      }
    }
    return null;
  };

  const goPrevious = () => {
    if (!currentSubject) return;
    if (currentQuestionIndex > 0) {
      jumpTo(currentSubjectIndex, currentQuestionIndex - 1);
      return;
    }
    if (currentSubjectIndex > 0) {
      const previousSubject = initialAttempt.subjects[currentSubjectIndex - 1];
      jumpTo(currentSubjectIndex - 1, Math.max(0, previousSubject.questions.length - 1));
    }
  };

  const goNext = () => {
    if (!currentSubject) return;
    if (currentQuestionIndex < currentSubject.questions.length - 1) {
      jumpTo(currentSubjectIndex, currentQuestionIndex + 1);
      return;
    }
    if (currentSubjectIndex < initialAttempt.subjects.length - 1) jumpTo(currentSubjectIndex + 1, 0);
  };

  if (submitted) {
    return (
      <div className="min-h-dvh bg-slate-50 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <div aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success-50 text-success-700"><Check className="h-6 w-6" /></div>
          <div className={cn("mt-5", typography.eyebrow, "text-success-700")}>Exam submitted</div>
          <h1 className={cn("mt-2", typography.h1)}>Your answers are locked in.</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
            {submitted.answeredCount} of {submitted.totalQuestions} questions were answered. {submitted.submissionReason === "time_expired" ? "The server submitted the paper when time expired." : "You submitted the paper manually."}
          </p>
          {sync.pendingCount > 0 && (
            <div className="mt-4 text-left">
              <InlineAlert tone="warning" role="alert">
                {sync.pendingCount} local changes were not confirmed before submission. Your result uses the server&apos;s saved answers. The local copy has been retained on this device.
              </InlineAlert>
            </div>
          )}
          <dl className="mt-6 grid grid-cols-3 gap-2">
            {[
              ["Answered", submitted.answeredCount],
              ["Unanswered", submitted.totalQuestions - submitted.answeredCount],
              ["Flagged", submitted.flaggedCount],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse rounded-xl bg-slate-50 p-3">
                <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
                <dd className="mono-number text-lg font-black leading-none text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 rounded-xl bg-brand-50 px-4 py-3 text-left text-xs leading-5 text-brand-600">
            Your result is ready. See your subject scores, review every answer and practise the topics that need attention.
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="primary" size="lg" onClick={() => router.push(`/progress/results/exam/${initialAttempt.id}`)}>View results</Button>
            <Button type="button" variant="secondary" size="lg" onClick={() => router.push("/home")}>Back home</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentSubject || !currentQuestion || !currentResponse) {
    return <div className="p-6 text-sm text-slate-600">This exam does not contain any questions to display.</div>;
  }

  const question = currentQuestion.question;
  const currentSubjectStats = subjectStats.find((item) => item.subjectId === currentSubject.id);
  const timerDanger = secondsLeft <= TIMER_DANGER_SECONDS;
  const timerWarning = secondsLeft <= TIMER_WARNING_SECONDS;

  const renderNavigator = (mobile: boolean) => (
    <div className={mobile ? "" : "sticky top-[var(--exam-chrome)] max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4"}>
      {!mobile ? <h2 className={cn("mb-4", typography.h2)}>Question navigator</h2> : null}
      <div className="space-y-5">
        {initialAttempt.subjects.map((subject, sIndex) => {
          const stats = subjectStats.find((item) => item.subjectId === subject.id);
          return (
            <section key={subject.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="truncate text-xs font-extrabold text-slate-800">{subject.name}</h3>
                <div className="mono-number text-[10px] font-semibold text-slate-500">{stats?.answered ?? 0}/{subject.questionCount}</div>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {subject.questions.map((item, qIndex) => {
                  const state = responses[item.id] ?? { selectedOptionKey: null, isFlagged: false };
                  const isCurrent = sIndex === currentSubjectIndex && qIndex === currentQuestionIndex;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => jumpTo(sIndex, qIndex)}
                      aria-current={isCurrent ? "true" : undefined}
                      aria-label={`${subject.name} question ${item.subjectPosition}${state.selectedOptionKey ? ", answered" : ", unanswered"}${state.isFlagged ? ", flagged" : ""}`}
                      className={cn(
                        "relative grid min-h-11 place-items-center rounded-lg border text-[11px] font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                        isCurrent
                          ? "border-brand-600 bg-brand-500 text-white ring-2 ring-brand-50"
                          : state.selectedOptionKey
                            ? "border-success-200 bg-success-50 text-success-800"
                            : "border-slate-200 bg-white text-slate-500",
                      )}
                    >
                      {item.subjectPosition}
                      {/* Answered is not carried by fill alone: it also gets a dot. */}
                      {state.selectedOptionKey && !isCurrent ? (
                        <span aria-hidden="true" className="absolute bottom-1 h-1 w-1 rounded-full bg-success-600" />
                      ) : null}
                      {state.isFlagged ? <Flag aria-hidden="true" className={cn("absolute right-0.5 top-0.5 h-2.5 w-2.5", isCurrent ? "text-warning-200" : "text-warning-600")} fill="currentColor" /> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 text-[10px] font-semibold text-slate-600">
        <div className="flex items-center gap-1.5"><span aria-hidden="true" className="relative grid h-3 w-3 place-items-center rounded border border-success-200 bg-success-50"><span className="h-0.5 w-0.5 rounded-full bg-success-600" /></span> Answered</div>
        <div className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded border border-slate-200 bg-white" /> Unanswered</div>
        <div className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded bg-brand-500 ring-2 ring-brand-50" /> Current</div>
        <div className="flex items-center gap-1.5"><Flag aria-hidden="true" className="h-3 w-3 text-warning-600" fill="currentColor" /> Flagged</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      {/*
        Header, offline banner and subject tabs share one sticky container, so
        the tabs sit below the header by ordinary layout. That replaces three
        hardcoded `top-[88px]` offsets that hid content whenever the exam title
        wrapped, the viewport narrowed, or the browser font size grew.
      */}
      <div className="sticky top-0 z-40">
        <header className="safe-area-top border-b border-slate-800 bg-slate-950 text-white">
          <div className="mx-auto max-w-[1280px] px-3 pb-2.5 pt-2.5 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <BrandMark compact inverse />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xs font-extrabold">{initialAttempt.examName} MOCK</h1>
                <div className="mono-number mt-0.5 truncate text-[10px] font-semibold text-white/60">{initialAttempt.examYear} · {answeredTotal}/{initialAttempt.totalQuestions} answered</div>
              </div>
              <div
                role="timer"
                aria-label={`Time remaining ${formatClock(secondsLeft)}`}
                className={cn(
                  "mono-number rounded-lg px-2.5 py-1.5 text-sm font-extrabold",
                  timerDanger ? "bg-danger-500/25 text-danger-100" : timerWarning ? "bg-warning-500/25 text-warning-100" : "bg-white/10 text-white",
                )}
              >
                {formatClock(secondsLeft)}
              </div>
            </div>
            <span aria-live="polite" className="sr-only">{timerAnnouncement}</span>

            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3 text-[10px] font-semibold">
                <SessionStatus state={saveState} online={online} inverse />
                <span className="inline-flex items-center gap-1.5 text-white/70">
                  {online ? <Wifi aria-hidden="true" className="h-3 w-3 text-success-300" /> : <WifiOff aria-hidden="true" className="h-3 w-3 text-danger-300" />}
                  {online ? "Online" : "Offline"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* Leaves the paper running; it never submits. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => setExitOpen(true)}
                  className="text-white/70 hover:bg-white/10 hover:text-white focus-visible:ring-white focus-visible:ring-offset-slate-950"
                  iconBefore={<LogOut className="h-4 w-4" aria-hidden="true" />}
                >
                  <span className="hidden sm:inline">Save &amp; exit</span>
                  <span className="sm:hidden">Exit</span>
                </Button>
                {/* Opens the review first — the header can never submit directly. */}
                <Button
                  type="button"
                  variant="danger"
                  size="md"
                  onClick={() => setSubmissionOpen(true)}
                  className="focus-visible:ring-white focus-visible:ring-offset-slate-950"
                  iconBefore={<Send className="h-4 w-4" aria-hidden="true" />}
                >
                  Submit
                </Button>
              </div>
            </div>
          </div>
        </header>

        {!online ? (
          <p className="border-b border-warning-200 bg-warning-50 px-4 py-2 text-center text-[11px] font-semibold text-warning-800">
            You&apos;re offline. New changes stay on this device and retry automatically when the connection returns.
          </p>
        ) : null}

        <nav aria-label="Exam subjects" className="overflow-x-auto border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-max min-w-full max-w-[1280px] px-2 sm:px-4">
            {initialAttempt.subjects.map((subject, index) => {
              const stats = subjectStats.find((item) => item.subjectId === subject.id);
              const active = index === currentSubjectIndex;
              return (
                <button
                  type="button"
                  key={subject.id}
                  onClick={() => jumpTo(index, 0)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex-none border-b-2 px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-4 motion-reduce:transition-none",
                    active ? "border-brand-500 text-slate-950" : "border-transparent text-slate-500",
                  )}
                >
                  <div className="max-w-32 truncate text-xs font-bold">{subject.name}</div>
                  <div className="mono-number mt-0.5 text-[10px] font-semibold">{stats?.answered ?? 0}/{subject.questionCount}</div>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      <SyncNotice ready={sync.ready} error={sync.error} code={sync.code} online={online} expired={secondsLeft === 0} onConflict={() => void sync.resolveConflict()} onStorageRetry={() => void sync.retryStorage()} />

      <main className="mx-auto grid max-w-[1280px] gap-5 px-4 pb-28 pt-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_290px] lg:pb-24">
        <div className="mx-auto w-full max-w-3xl lg:mx-0 lg:max-w-none">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className={cn(typography.eyebrow, "text-brand-600")}>{currentSubject.name}</div>
              <h2 className="mt-1 text-sm font-extrabold text-slate-950">
                Question {currentQuestion.subjectPosition} of {currentSubject.questionCount}
              </h2>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!sync.ready || submitting || secondsLeft === 0}
              aria-pressed={currentResponse.isFlagged}
              onClick={() => queueResponse(currentQuestion.id, { ...currentResponse, isFlagged: !currentResponse.isFlagged })}
              className={cn("min-h-11", currentResponse.isFlagged && "border-warning-300 bg-warning-50 text-warning-800 hover:bg-warning-50")}
              iconBefore={<Flag className="h-3.5 w-3.5" aria-hidden="true" fill={currentResponse.isFlagged ? "currentColor" : "none"} />}
            >
              {currentResponse.isFlagged ? "Flagged" : "Flag"}
            </Button>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-7">
            {question.passage ? (
              <button
                type="button"
                onClick={() => setPassageOpen(true)}
                className="mb-4 flex w-full items-center justify-between gap-3 rounded-xl border border-brand-500/20 bg-brand-50 px-3.5 py-3 text-left transition hover:border-brand-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
              >
                <span>
                  <span className={cn("block", typography.eyebrow, "text-brand-600")}>Comprehension passage</span>
                  <span className="mt-1 block text-xs font-semibold text-slate-600">Open the passage without losing your answer</span>
                </span>
                <span className="shrink-0 text-xs font-bold text-brand-600">View passage</span>
              </button>
            ) : null}

            {question.assets.length > 0 ? (
              <div className="mb-5 grid gap-3">
                {question.assets.map((asset) => (
                  <figure key={asset.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <Image src={asset.url} alt={asset.altText || "Question illustration"} width={960} height={640} unoptimized className="h-auto max-h-[420px] w-full rounded-lg object-contain" />
                    {asset.caption ? <figcaption className="px-2 pb-1 pt-2 text-xs text-slate-500">{asset.caption}</figcaption> : null}
                  </figure>
                ))}
              </div>
            ) : null}

            <p className="text-[16px] font-semibold leading-7 text-slate-800 sm:text-[17px] sm:leading-8">{question.prompt}</p>
            <div className="mt-6 space-y-2.5">
              {question.options.map((option) => {
                const selected = currentResponse.selectedOptionKey === option.key;
                return (
                  // Answer choices keep their own markup and state: a single-select
                  // group with `aria-pressed`, not a Button. Only focus, radius and
                  // colour tokens are shared.
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={selected}
                    disabled={!sync.ready || submitting || secondsLeft === 0}
                    onClick={() => queueResponse(currentQuestion.id, { ...currentResponse, selectedOptionKey: option.key })}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm font-semibold transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                      selected ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                  >
                    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold", selected ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600")}>{option.key}</span>
                    <span className="leading-6">{option.text}</span>
                    {selected ? <Check aria-hidden="true" className="ml-auto h-4 w-4 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => queueResponse(currentQuestion.id, { ...currentResponse, selectedOptionKey: null })}
              disabled={!sync.ready || submitting || secondsLeft === 0 || !currentResponse.selectedOptionKey}
              className="mt-4 min-h-11 text-slate-500"
            >
              Clear answer
            </Button>
          </section>
          <div className="mono-number mt-3 text-center text-[10px] font-semibold text-slate-500">{currentSubjectStats?.answered ?? 0}/{currentSubject.questionCount} answered in {currentSubject.name}</div>
        </div>

        <aside className="hidden lg:block">{renderNavigator(false)}</aside>
      </main>

      {/*
        The exam shell has no student tab bar, so this bar sits flush to the
        bottom edge and must not take the shared nav clearance.
      */}
      <div className="safe-area-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 pb-2 pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-[1fr_auto_1fr] gap-2 lg:max-w-5xl">
          <Button type="button" variant="secondary" size="md" onClick={goPrevious} iconBefore={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}>
            Previous
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={() => setNavigatorOpen(true)} className="border-0 bg-slate-100 lg:hidden" iconBefore={<Grid3X3 className="h-4 w-4" aria-hidden="true" />}>
            Questions
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={() => setSubmissionOpen(true)} className="hidden border-0 bg-slate-100 lg:inline-flex" iconBefore={<Send className="h-4 w-4" aria-hidden="true" />}>
            Review
          </Button>
          <Button type="button" variant="primary" size="md" onClick={goNext} iconAfter={<ChevronRight className="h-4 w-4" aria-hidden="true" />}>
            Next
          </Button>
        </div>
      </div>

      <Sheet
        open={navigatorOpen}
        onClose={() => setNavigatorOpen(false)}
        title="Questions"
        description={`${answeredTotal} answered · ${flaggedTotal} flagged`}
        size="lg"
      >
        {renderNavigator(true)}
      </Sheet>

      {question.passage ? (
        <Sheet
          open={passageOpen}
          onClose={() => setPassageOpen(false)}
          title={question.passage.title || "Read the passage carefully"}
          description="Comprehension passage"
          size="full"
          footer={
            <Button type="button" variant="dark" size="lg" fullWidth onClick={() => setPassageOpen(false)}>
              Back to question {currentQuestion.subjectPosition}
            </Button>
          }
        >
          {/* Content is rendered exactly as normalised upstream — no parsing here. */}
          <p className="max-w-prose whitespace-pre-line text-[15px] leading-8 text-slate-700">{question.passage.body}</p>
        </Sheet>
      ) : null}

      <Sheet
        open={submissionOpen}
        onClose={() => setSubmissionOpen(false)}
        dismissible={!submitting}
        title="Check before you submit"
        description="Submission review"
        footer={
          <div className="space-y-2">
            <Button
              type="button"
              variant="danger"
              size="lg"
              fullWidth
              disabled={submitting}
              loading={submitting}
              loadingLabel="Submitting your paper…"
              onClick={() => void sync.finish(secondsLeft === 0)}
              iconBefore={<Send className="h-4 w-4" aria-hidden="true" />}
            >
              Submit exam — this cannot be undone
            </Button>
            <Button type="button" variant="ghost" size="md" fullWidth disabled={submitting} onClick={() => setSubmissionOpen(false)}>
              Continue exam
            </Button>
          </div>
        }
      >
        <dl className="grid grid-cols-3 gap-2">
          {[
            ["Answered", answeredTotal, "bg-success-50 text-success-800", "text-success-700"],
            ["Unanswered", unansweredTotal, "bg-slate-50 text-slate-800", "text-slate-600"],
            ["Flagged", flaggedTotal, "bg-warning-50 text-warning-800", "text-warning-700"],
          ].map(([label, value, tile, caption]) => (
            <div key={label as string} className={cn("flex flex-col-reverse rounded-xl p-3 text-center", tile as string)}>
              <dt className={cn("mt-1 text-[10px] font-bold", caption as string)}>{label}</dt>
              <dd className="mono-number text-xl font-black leading-none">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 space-y-2">
          {initialAttempt.subjects.map((subject) => {
            const stats = subjectStats.find((item) => item.subjectId === subject.id);
            return (
              <div key={subject.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3.5 py-3 text-sm">
                <span className="font-bold text-slate-800">{subject.name}</span>
                <span className="mono-number text-xs font-bold text-slate-500">{stats?.answered ?? 0}/{subject.questionCount}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={unansweredTotal === 0 || submitting}
            onClick={() => { const found = findFirst((state) => !state.selectedOptionKey); if (found) jumpTo(found.sIndex, found.qIndex); }}
          >
            Review unanswered
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={flaggedTotal === 0 || submitting}
            onClick={() => { const found = findFirst((state) => state.isFlagged); if (found) jumpTo(found.sIndex, found.qIndex); }}
          >
            Review flagged
          </Button>
        </div>

        {sync.pendingCount > 0 ? (
          <div className="mt-4">
            <InlineAlert tone="warning" role="status">
              Some recent changes are still waiting to sync. Final submission will wait for them while you are online.
            </InlineAlert>
          </div>
        ) : null}
      </Sheet>

      {/*
        Leaving is navigation only. The attempt stays open, the server keeps the
        clock, and nothing is submitted or discarded here.
      */}
      <Sheet
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Leave the exam running?"
        description="Your paper stays open and can be resumed."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" size="lg" onClick={() => setExitOpen(false)}>
              Stay in the exam
            </Button>
            <Button type="button" variant="dark" size="lg" onClick={() => router.push("/mock")}>
              Save &amp; exit
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-slate-600">
          Every answer you have given is already saved. Leaving does not submit your paper.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          <strong className="font-bold text-slate-900">The timer keeps running.</strong> The server controls the clock,
          so it continues while you are away and submits the paper automatically when time expires.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {answeredTotal} of {initialAttempt.totalQuestions} answered, {flaggedTotal} flagged, {formatClock(secondsLeft)} left.
        </p>
      </Sheet>
    </div>
  );
}
