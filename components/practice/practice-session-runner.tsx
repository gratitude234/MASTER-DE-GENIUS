"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  LoaderCircle,
  RotateCcw,
  WifiOff,
  XCircle,
} from "lucide-react";

import type {
  CompletePracticeSessionResult,
  PracticeSessionView,
} from "@/features/practice/types";
import { useOfflineSession } from "@/features/offline/use-session";
import { SyncNotice } from "@/components/pwa/sync-notice";

interface PracticeSessionRunnerProps {
  recovered?: boolean;
  initialSession: PracticeSessionView;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function scorePercent(correct: number, total: number) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
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
  const visibleAnsweredCount = useMemo(
    () => Object.values(answers).filter((answer) => Boolean(answer.selectedOptionKey)).length,
    [answers],
  );

  if (completion) {
    const pct = scorePercent(completion.correctCount, completion.questionCount);
    return (
      <div className="mx-auto max-w-xl py-4 sm:py-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Session complete</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{completion.correctCount} / {completion.questionCount}</h1>
          <div className="mt-1 text-sm font-semibold text-slate-500">{pct}% accuracy · {completion.answeredCount} answered</div>
          <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-slate-600">
            Your answers are saved. Open your result to review explanations, topic performance and mistakes.
          </p>
          {sync.pendingCount > 0 && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{sync.pendingCount} local changes were not confirmed before completion. Your result uses the server’s saved answers; the local copy is retained.</p>}
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link href="/practice" className="flex h-12 items-center justify-center rounded-xl bg-blue-600 px-4 font-bold text-white hover:bg-blue-700">
              <RotateCcw className="mr-2 h-4 w-4" /> Practice again
            </Link>
            <Link href={`/progress/results/practice/${initialSession.id}`} className="flex h-12 items-center justify-center rounded-xl border border-slate-200 px-4 font-bold text-slate-700 hover:bg-slate-50">
              Review results
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!current || !currentState) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        This practice session has no questions to display.
      </div>
    );
  }

  const feedback = currentState.feedback;
  const question = current.question;
  const progressPercent = Math.round(((currentIndex + 1) / initialSession.questionCount) * 100);
  const finalQuestion = currentIndex === initialSession.questions.length - 1;

  return (
    <div className="mx-auto max-w-3xl pb-24 lg:pb-8">
      <header className="mb-4 flex items-center justify-between gap-3">
        <a href={recovered ? "/offline" : "/practice"} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" /> Exit
        </a>
        <div className="flex items-center gap-2">
          {saveState === "saving" || saveState === "syncing" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {saveState === "syncing" ? "Syncing" : "Saving"}
            </span>
          ) : saveState === "saved_local" ? (
            <button type="button" onClick={() => void flushPending()} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
              <WifiOff className="h-3.5 w-3.5" /> Saved on device
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <Cloud className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {isTimed && secondsLeft != null ? (
            <span className={`inline-flex min-w-[70px] items-center justify-center gap-1 rounded-full px-2.5 py-1 font-mono text-xs font-bold ${secondsLeft <= 60 ? "bg-red-50 text-red-700" : "bg-slate-950 text-white"}`}>
              <Clock3 className="h-3.5 w-3.5" /> {formatTime(secondsLeft)}
            </span>
          ) : null}
        </div>
      </header>

      <section className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
          <span>{initialSession.subjectName}{initialSession.topicName ? ` · ${initialSession.topicName}` : ""}</span>
          <span>{visibleAnsweredCount}/{initialSession.questionCount} answered</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      </section>

      <SyncNotice ready={sync.ready} error={sync.error} code={sync.code} online={sync.online} expired={secondsLeft === 0} onConflict={() => void sync.resolveConflict()} onStorageRetry={() => void sync.retryStorage()} />
      <main className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Question {current.position}</div>
            <div className="mt-1 text-xs text-slate-400">of {initialSession.questionCount}{question.year ? ` · ${question.year}` : ""}</div>
          </div>
          <div className="rounded-full bg-slate-50 px-3 py-1 text-[11px] font-bold capitalize text-slate-500">
            {initialSession.mode} mode
          </div>
        </div>

        {question.passage ? (
          <div className="mt-5 max-h-64 overflow-y-auto rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
            <div className="text-xs font-bold uppercase tracking-[0.15em] text-blue-700">{question.passage.title || "Passage"}</div>
            <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-700">{question.passage.body}</p>
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

        <h1 className="mt-5 text-[17px] font-semibold leading-7 text-slate-950 sm:text-lg sm:leading-8">{question.prompt}</h1>

        <div className="mt-5 space-y-2.5">
          {question.options.map((option) => {
            const selected = currentState.selectedOptionKey === option.key;
            const correct = Boolean(feedback && feedback.correctOptionKey === option.key);
            const wrongSelected = Boolean(feedback && selected && !feedback.isCorrect);
            const feedbackLocked = initialSession.mode === "practice" && Boolean(feedback);

            let optionClass = "border-slate-200 bg-white text-slate-800 hover:border-slate-300";
            let keyClass = "bg-slate-100 text-slate-600";
            if (selected && !feedback) {
              optionClass = "border-blue-600 bg-blue-50 text-slate-950";
              keyClass = "bg-blue-600 text-white";
            }
            if (correct) {
              optionClass = "border-emerald-600 bg-emerald-50 text-slate-950";
              keyClass = "bg-emerald-600 text-white";
            } else if (wrongSelected) {
              optionClass = "border-red-500 bg-red-50 text-slate-950";
              keyClass = "bg-red-500 text-white";
            }

            return (
              <button
                key={option.id}
                type="button"
                disabled={!sync.ready || feedbackLocked || completing || secondsLeft === 0 || (initialSession.mode === "practice" && Boolean(currentState.selectedOptionKey))}
                aria-pressed={selected}
                onClick={() => void sync.select(current.id, { selectedOptionKey: option.key, isFlagged: false })}
                className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left text-sm font-medium leading-6 transition disabled:cursor-default ${optionClass}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${keyClass}`}>{option.key}</span>
                <span className="flex-1">{option.text}</span>
                {correct ? <Check className="h-4 w-4 shrink-0 text-emerald-700" /> : null}
                {wrongSelected ? <XCircle className="h-4 w-4 shrink-0 text-red-600" /> : null}
              </button>
            );
          })}
        </div>

        {feedback ? (
          <div className={`mt-5 rounded-2xl border p-4 ${feedback.isCorrect ? "border-emerald-200 bg-emerald-50/70" : "border-red-200 bg-red-50/70"}`}>
            <div className={`flex items-center gap-2 text-sm font-bold ${feedback.isCorrect ? "text-emerald-800" : "text-red-800"}`}>
              {feedback.isCorrect ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {feedback.isCorrect ? "Correct" : `Incorrect · correct answer: ${feedback.correctOptionKey}`}
            </div>
            {feedback.explanation ? <p className="mt-2 text-sm leading-6 text-slate-700">{feedback.explanation}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
              {question.topic?.name ? <span className="rounded-full bg-white/70 px-2.5 py-1">{question.topic.name}</span> : null}
              {question.difficulty ? <span className="rounded-full bg-white/70 px-2.5 py-1 capitalize">{question.difficulty}</span> : null}
            </div>
          </div>
        ) : currentState.selectedOptionKey && !feedback && initialSession.mode === "practice" ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
            {sync.ready && saveState !== "saving" ? "Your answer is saved on this device. Feedback will appear after it syncs." : "Your answer has not yet been confirmed in device storage."}
          </div>
        ) : null}
      </main>

      <div className={`fixed inset-x-0 ${recovered ? "bottom-0 safe-area-bottom" : "bottom-[calc(4.25rem+env(safe-area-inset-bottom))]"} z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0`}>
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button
            type="button"
            aria-label="Previous question"
            onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            disabled={currentIndex === 0}
            className="flex h-12 min-w-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Previous</span>
          </button>

          {finalQuestion ? (
            <button
              type="button"
              onClick={() => void completeSession()}
              disabled={completing}
              className="flex h-12 flex-1 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-60"
            >
              {completing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Finish session
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCurrentIndex((index) => Math.min(initialSession.questions.length - 1, index + 1))}
              className="flex h-12 flex-1 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
            >
              Next question <ChevronRight className="ml-1 h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
