"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RotateCcw,
  XCircle,
} from "lucide-react";

import type {
  CompletePracticeSessionResult,
  PracticeSessionView,
} from "@/features/practice/types";
import { useOfflineSession } from "@/features/offline/use-session";
import { SessionStatus, presentSaveState } from "@/components/pwa/session-status";
import { SyncNotice } from "@/components/pwa/sync-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Sheet } from "@/components/ui/sheet";
import { buttonClasses, navClearance, typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

interface PracticeSessionRunnerProps {
  recovered?: boolean;
  initialSession: PracticeSessionView;
}

/** The one low-time threshold this screen already had. No new exam policy. */
const LOW_TIME_SECONDS = 60;

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function scorePercent(correct: number, total: number) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

/**
 * Speaks only when the timer crosses a band the UI already treats as different.
 * A per-second announcement would make the session unusable with a screen
 * reader, and the visible clock stays readable on demand via `role="timer"`.
 */
function useTimerAnnouncement(secondsLeft: number | null | undefined) {
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef<string | null>(null);

  const band = secondsLeft == null ? null : secondsLeft === 0 ? "expired" : secondsLeft <= LOW_TIME_SECONDS ? "low" : "normal";

  useEffect(() => {
    if (band === null) return;
    const last = previous.current;
    previous.current = band;
    if (last === null || last === band) return;
    if (band === "low") setAnnouncement("Less than one minute remaining.");
    else if (band === "expired") setAnnouncement("Time is up.");
    else setAnnouncement("");
  }, [band]);

  return announcement;
}

export function PracticeSessionRunner({ initialSession, recovered = false }: PracticeSessionRunnerProps) {
  const sync = useOfflineSession("practice", initialSession, recovered);
  const { answers, state: saveState, secondsLeft, finishing: completing } = sync;
  const completion = sync.receipt as unknown as CompletePracticeSessionResult | null;
  const currentIndex = Math.min(sync.cursor.question, initialSession.questions.length - 1);
  const setCurrentIndex = (next: number | ((current: number) => number)) => sync.setCursor({ subject: 0, question: typeof next === "function" ? next(currentIndex) : next });
  const current = initialSession.questions[currentIndex];
  const currentState = current ? answers[current.id] : null;
  const isTimed = initialSession.mode === "timed";
  const flushPending = sync.flush;
  const completeSession = () => sync.finish(secondsLeft === 0);
  const [exitOpen, setExitOpen] = useState(false);
  const timerAnnouncement = useTimerAnnouncement(isTimed ? secondsLeft : null);
  const visibleAnsweredCount = useMemo(
    () => Object.values(answers).filter((answer) => Boolean(answer.selectedOptionKey)).length,
    [answers],
  );

  if (completion) {
    const pct = scorePercent(completion.correctCount, completion.questionCount);
    return (
      <div className="screen-enter mx-auto max-w-[460px] py-6 sm:py-12">
        <div className="rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center">
          <div aria-hidden="true" className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-success-50 text-success-600">
            <CheckCircle2 className="h-[22px] w-[22px]" />
          </div>
          <div className={cn("mt-4", typography.eyebrow, "text-success-600")}>Session complete</div>
          <p className="mono-number mt-3 text-[38px] font-semibold leading-none text-slate-950">
            <span className="sr-only">Score: </span>{completion.correctCount} / {completion.questionCount}
          </p>
          <div className="mt-2 text-[13px] text-slate-500">{pct}% accuracy · {completion.answeredCount} answered</div>
          <p className="mx-auto mt-4 max-w-md text-[13px] leading-[1.6] text-slate-600">
            Your answers are saved. Review explanations and topic performance from your result.
          </p>
          {sync.pendingCount > 0 && (
            <div className="mt-4 text-left">
              <InlineAlert tone="warning" role="alert">
                {sync.pendingCount} local changes were not confirmed before completion. Your result uses the server&apos;s saved answers; the local copy is retained.
              </InlineAlert>
            </div>
          )}
          {/* Reviewing the result is the next step; practising again is the alternative. */}
          <div className="mt-6 flex flex-col gap-2.5">
            <Link href={`/progress/results/practice/${initialSession.id}`} className={buttonClasses({ variant: "dark", size: "lg" })}>
              Review results
            </Link>
            <Link href="/practice" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Practise again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!current || !currentState) {
    return (
      <div className="mx-auto max-w-[680px] rounded-2xl border border-slate-200 bg-white p-6 text-[13.5px] text-slate-600">
        This practice session has no questions to display.
      </div>
    );
  }

  const feedback = currentState.feedback;
  const question = current.question;
  const progressPercent = Math.round(((currentIndex + 1) / initialSession.questionCount) * 100);
  const finalQuestion = currentIndex === initialSession.questions.length - 1;
  const exitHref = recovered ? "/offline" : "/practice";
  const status = presentSaveState(saveState, sync.online);

  /** Says what is actually true right now — never promises a sync that has not happened. */
  const exitReassurance =
    status.band === "working"
      ? "One answer is still saving. Give it a moment before you leave, or it will finish syncing when you return."
      : status.band === "synced"
        ? "Every answer you have given is saved to your account. You can pick this session up from Practice."
        : "Your answers are saved on this device and will sync when you are back online. Leaving now will not lose them.";

  return (
    <div className="screen-enter mx-auto max-w-[680px] pb-24 lg:pb-8">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => setExitOpen(true)}
          iconBefore={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
        >
          Exit
        </Button>
        <div className="flex items-center gap-2">
          <SessionStatus state={saveState} online={sync.online} onRetry={() => void flushPending()} />
          {isTimed && secondsLeft != null ? (
            <>
              <span
                role="timer"
                aria-label={`Time remaining ${formatTime(secondsLeft)}`}
                className={cn(
                  "mono-number inline-flex min-w-[70px] items-center justify-center gap-1 rounded-full px-2.5 py-1.5 text-[12.5px] font-bold",
                  secondsLeft <= LOW_TIME_SECONDS ? "bg-danger-50 text-danger-700" : "bg-slate-950 text-white",
                )}
              >
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> {formatTime(secondsLeft)}
              </span>
              <span aria-live="polite" className="sr-only">{timerAnnouncement}</span>
            </>
          ) : null}
        </div>
      </header>

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
        <div className="flex items-center justify-between gap-3 text-[11.5px] font-semibold text-slate-600">
          <h1 className="truncate text-[11.5px] font-semibold text-slate-600">
            {initialSession.subjectName}{initialSession.topicName ? ` · ${initialSession.topicName}` : ""}
            <span className="sr-only"> practice session</span>
          </h1>
          <span>{visibleAnsweredCount}/{initialSession.questionCount} answered</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={currentIndex + 1}
          aria-valuemin={1}
          aria-valuemax={initialSession.questionCount}
          aria-label="Session progress"
          className="mt-2 h-[5px] overflow-hidden rounded-full bg-slate-100"
        >
          <div className="h-full rounded-full bg-brand-500 transition-all motion-reduce:transition-none" style={{ width: `${progressPercent}%` }} />
        </div>
      </section>

      <SyncNotice ready={sync.ready} error={sync.error} code={sync.code} online={sync.online} expired={secondsLeft === 0} onConflict={() => void sync.resolveConflict()} onStorageRetry={() => void sync.retryStorage()} />

      <main className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={cn(typography.eyebrow, "tracking-[0.08em] text-brand-500")}>
              Question {current.position} of {initialSession.questionCount}
            </h2>
            {question.year ? <div className="mt-1 text-[11px] text-slate-500">{question.year}</div> : null}
          </div>
          <Badge tone="neutral">{initialSession.mode === "timed" ? "Timed" : "Practice"} mode</Badge>
        </div>

        {question.passage ? (
          <div className="mt-4 max-h-64 overflow-y-auto rounded-2xl bg-brand-50 px-4 py-3.5">
            <h3 className={cn(typography.eyebrow, "tracking-[0.08em] text-brand-500")}>{question.passage.title || "Passage"}</h3>
            <p className="mt-1.5 max-w-prose whitespace-pre-line text-[13px] leading-[1.7] text-slate-800">{question.passage.body}</p>
          </div>
        ) : null}

        {question.assets.length > 0 ? (
          <div className="mt-5 grid gap-3">
            {question.assets.map((asset) => (
              <figure key={asset.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
                <Image
                  src={asset.url}
                  alt={asset.altText || "Question illustration"}
                  width={960}
                  height={640}
                  unoptimized
                  className="h-auto w-full rounded-xl object-contain"
                />
                {asset.caption ? <figcaption className="px-2 pb-1 pt-2 text-xs text-slate-500">{asset.caption}</figcaption> : null}
              </figure>
            ))}
          </div>
        ) : null}

        <p className="mt-4 text-[17px] font-semibold leading-[1.55] text-slate-950">{question.prompt}</p>

        <div className="mt-4 space-y-2.5">
          {question.options.map((option) => {
            const selected = currentState.selectedOptionKey === option.key;
            const correct = Boolean(feedback && feedback.correctOptionKey === option.key);
            const wrongSelected = Boolean(feedback && selected && !feedback.isCorrect);
            const feedbackLocked = initialSession.mode === "practice" && Boolean(feedback);

            let optionClass = "border-slate-200 bg-white text-slate-800 hover:border-slate-300";
            let keyClass = "bg-slate-100 text-slate-600";
            if (selected && !feedback) {
              optionClass = "border-[1.5px] border-brand-500 bg-brand-50 text-slate-950";
              keyClass = "bg-brand-500 text-white";
            }
            if (correct) {
              optionClass = "border-[1.5px] border-success-600 bg-success-50 text-slate-950";
              keyClass = "bg-success-600 text-white";
            } else if (wrongSelected) {
              optionClass = "border-[1.5px] border-danger-600 bg-danger-50 text-slate-950";
              keyClass = "bg-danger-600 text-white";
            }

            return (
              // Answer choices keep their own markup and their own state: they
              // are a single-select group with feedback locking, not a Button.
              // Only the focus, radius and colour tokens are shared.
              <button
                key={option.id}
                type="button"
                disabled={!sync.ready || feedbackLocked || completing || secondsLeft === 0 || (initialSession.mode === "practice" && Boolean(currentState.selectedOptionKey))}
                aria-pressed={selected}
                onClick={() => void sync.select(current.id, { selectedOptionKey: option.key, isFlagged: false })}
                className={cn(
                  "flex min-h-[54px] w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-[13.5px] font-medium leading-[1.5] transition disabled:cursor-default",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                  optionClass,
                )}
              >
                <span className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-xs font-bold", keyClass)}>{option.key}</span>
                <span className="flex-1">{option.text}</span>
                {correct ? <Check className="h-4 w-4 shrink-0 text-success-600" aria-hidden="true" /> : null}
                {wrongSelected ? <XCircle className="h-4 w-4 shrink-0 text-danger-600" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        {feedback ? (
          <div className={cn("mt-4 rounded-2xl border px-4 py-3.5", feedback.isCorrect ? "border-success-200 bg-success-50" : "border-danger-200 bg-danger-50")}>
            <p className={cn("flex items-center gap-2 text-[13px] font-bold", feedback.isCorrect ? "text-success-600" : "text-danger-600")}>
              {feedback.isCorrect ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
              {feedback.isCorrect ? "Correct" : `Incorrect · correct answer: ${feedback.correctOptionKey}`}
            </p>
            {feedback.explanation ? <p className="mt-2 text-[13px] leading-[1.6] text-slate-800">{feedback.explanation}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {question.topic?.name ? <Badge tone="neutral">{question.topic.name}</Badge> : null}
              {question.difficulty ? <Badge tone="neutral" className="capitalize">{question.difficulty}</Badge> : null}
            </div>
          </div>
        ) : currentState.selectedOptionKey && !feedback && initialSession.mode === "practice" ? (
          <div className="mt-5">
            <InlineAlert tone="warning" role="status">
              {sync.ready && saveState !== "saving" ? "Your answer is saved on this device. Feedback will appear after it syncs." : "Your answer has not yet been confirmed in device storage."}
            </InlineAlert>
          </div>
        ) : null}
      </main>

      <div
        className={cn(
          "fixed inset-x-0 z-20 border-t border-slate-200 bg-white/[0.97] p-3 backdrop-blur lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0",
          // The recovered runner lives on /offline, which has no tab bar; the
          // normal one sits inside the student shell, which does.
          recovered ? "bottom-0 safe-area-bottom" : navClearance.bottom,
        )}
      >
        <div className="mx-auto flex max-w-[680px] items-center gap-2.5">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            aria-label="Previous question"
            onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            disabled={currentIndex === 0}
            className="min-w-12"
          >
            <ChevronLeft className="h-4 w-4 sm:mr-1" aria-hidden="true" /> <span className="hidden sm:inline">Previous</span>
          </Button>

          {finalQuestion ? (
            <Button
              type="button"
              variant="dark"
              size="lg"
              className="flex-1"
              onClick={() => void completeSession()}
              loading={completing}
              loadingLabel="Finishing session…"
              iconBefore={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            >
              Finish session
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="flex-1"
              onClick={() => setCurrentIndex((index) => Math.min(initialSession.questions.length - 1, index + 1))}
              iconAfter={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
            >
              Next question
            </Button>
          )}
        </div>
      </div>

      {/*
        Leaving is presentation only: it navigates. Nothing is submitted,
        discarded or flushed here — the session resumes exactly as the engine
        already saved it.
      */}
      <Sheet
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Leave this practice session?"
        description="You can come back and finish it later."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" size="lg" onClick={() => setExitOpen(false)}>
              Stay in this session
            </Button>
            {/*
              A plain anchor, not next/link: the recovered runner is reached from
              /offline, and a client-side navigation needs an RSC fetch that a
              disconnected device cannot make. A document navigation is served
              from the cached shell.
            */}
            <a href={exitHref} className={buttonClasses({ variant: "dark", size: "lg" })}>
              Leave session
            </a>
          </div>
        }
      >
        <p className="text-[13px] leading-[1.6] text-slate-600">{exitReassurance}</p>
        <p className="mt-2.5 text-[13px] leading-[1.6] text-slate-600">
          {visibleAnsweredCount} of {initialSession.questionCount} answered so far.
          {isTimed ? " This is a timed session — the clock keeps running while you are away." : ""}
        </p>
      </Sheet>
    </div>
  );
}
