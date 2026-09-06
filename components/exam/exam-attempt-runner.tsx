"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Flag,
  Grid3X3,
  LoaderCircle,
  LogOut,
  Send,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import { BrandMark } from "@/components/brand/brand-mark";
import type {
  ExamAttemptView,
  SubmitExamAttemptResult,
} from "@/features/exams/types";
import type { QuestionOption } from "@/types/domain";

import { useOfflineSession } from "@/features/offline/use-session";
import { SyncNotice } from "@/components/pwa/sync-notice";

interface ExamAttemptRunnerProps {
  recovered?: boolean;
  initialAttempt: ExamAttemptView;
}

interface LocalResponse {
  selectedOptionKey: QuestionOption["key"] | null;
  isFlagged: boolean;
}

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

export function ExamAttemptRunner({ initialAttempt, recovered = false }: ExamAttemptRunnerProps) {
  const router = useRouter();
  const sync = useOfflineSession("exam", initialAttempt, recovered);
  const { answers: responses, state: saveState, online, finishing: submitting } = sync;
  const submitted = sync.receipt as unknown as SubmitExamAttemptResult | null ?? submittedFromAttempt(initialAttempt);
  const secondsLeft = sync.secondsLeft ?? 0;
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [passageOpen, setPassageOpen] = useState(false);
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
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check className="h-6 w-6" /></div>
          <div className="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-700">Exam submitted</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Your answers are locked in.</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
            {submitted.answeredCount} of {submitted.totalQuestions} questions were answered. {submitted.submissionReason === "time_expired" ? "The server submitted the paper when time expired." : "You submitted the paper manually."}
          </p>
          {sync.pendingCount > 0 && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{sync.pendingCount} local changes were not confirmed before submission. Your result uses the server’s saved answers. The local copy has been retained on this device.</p>}
          <div className="mt-6 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-lg font-black text-slate-950">{submitted.answeredCount}</div><div className="text-[11px] font-semibold text-slate-400">Answered</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-lg font-black text-slate-950">{submitted.totalQuestions - submitted.answeredCount}</div><div className="text-[11px] font-semibold text-slate-400">Unanswered</div></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-lg font-black text-slate-950">{submitted.flaggedCount}</div><div className="text-[11px] font-semibold text-slate-400">Flagged</div></div>
          </div>
          <div className="mt-6 rounded-xl bg-blue-50 px-4 py-3 text-left text-xs leading-5 text-blue-800">
            Your result is ready. See your subject scores, review every answer and practise the topics that need attention.
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => router.push(`/progress/results/exam/${initialAttempt.id}`)} className="h-12 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white">View Results</button>
            <button type="button" onClick={() => router.push("/home")} className="h-12 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700">Back Home</button>
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
  const timerDanger = secondsLeft <= 300;
  const timerWarning = secondsLeft <= 600;

  const renderNavigator = (mobile: boolean) => (
    <div className={mobile ? "max-h-[72dvh] overflow-y-auto px-4 pb-6" : "sticky top-32 max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4"}>
      {!mobile ? <div className="mb-4 text-sm font-black text-slate-950">Question Navigator</div> : null}
      <div className="space-y-5">
        {initialAttempt.subjects.map((subject, sIndex) => {
          const stats = subjectStats.find((item) => item.subjectId === subject.id);
          return (
            <section key={subject.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="truncate text-xs font-extrabold text-slate-800">{subject.name}</div>
                <div className="text-[10px] font-semibold text-slate-400">{stats?.answered ?? 0}/{subject.questionCount}</div>
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
                      aria-label={`${subject.name} question ${item.subjectPosition}${state.selectedOptionKey ? ", answered" : ", unanswered"}${state.isFlagged ? ", flagged" : ""}`}
                      className={`relative grid aspect-square min-h-9 place-items-center rounded-lg border text-[11px] font-extrabold transition ${
                        isCurrent
                          ? "border-blue-600 bg-blue-600 text-white ring-2 ring-blue-100"
                          : state.selectedOptionKey
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-white text-slate-500"
                      }`}
                    >
                      {item.subjectPosition}
                      {state.isFlagged ? <Flag className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 ${isCurrent ? "text-amber-200" : "text-amber-600"}`} fill="currentColor" /> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 text-[10px] font-semibold text-slate-500">
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-emerald-200 bg-emerald-50" /> Answered</div>
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-slate-200 bg-white" /> Unanswered</div>
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-blue-600" /> Current</div>
        <div className="flex items-center gap-1.5"><Flag className="h-3 w-3 text-amber-600" fill="currentColor" /> Flagged</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <header className="safe-area-top sticky top-0 z-40 border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto max-w-[1280px] px-3 pb-2.5 pt-2.5 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <BrandMark compact inverse />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-extrabold">{initialAttempt.examName} MOCK</div>
              <div className="mt-0.5 truncate text-[10px] font-semibold text-white/40">{initialAttempt.examYear} · {answeredTotal}/{initialAttempt.totalQuestions} answered</div>
            </div>
            <div className={`mono-number rounded-lg px-2.5 py-1.5 text-sm font-extrabold ${timerDanger ? "bg-red-500/20 text-red-200" : timerWarning ? "bg-amber-500/20 text-amber-100" : "bg-white/10 text-white"}`}>
              {formatClock(secondsLeft)}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-semibold">
            <div className="flex min-w-0 items-center gap-3 text-white/55">
              <span className="inline-flex items-center gap-1.5">
                {saveState === "saving" || saveState === "syncing" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : saveState === "saved_local" ? <WifiOff className="h-3 w-3 text-amber-300" /> : <Cloud className="h-3 w-3 text-emerald-300" />}
                {saveState === "saving" ? "Saving…" : saveState === "syncing" ? "Syncing…" : saveState === "saved_local" ? "Saved on device" : "✓ Saved"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {online ? <Wifi className="h-3 w-3 text-emerald-300" /> : <WifiOff className="h-3 w-3 text-red-300" />}
                {online ? "Online" : "Offline"}
              </span>
            </div>
            <button type="button" onClick={() => setSubmissionOpen(true)} className="shrink-0 font-extrabold text-red-300 hover:text-red-200">Submit</button>
          </div>
        </div>
      </header>

      {!online ? (
        <div className="sticky top-[88px] z-30 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[11px] font-semibold text-amber-800">
          You&apos;re offline. New changes stay on this device and retry automatically when the connection returns.
        </div>
      ) : null}

      <div className="sticky top-[88px] z-20 overflow-x-auto border-b border-slate-200 bg-white lg:top-[88px]">
        <div className="mx-auto flex w-max min-w-full max-w-[1280px] px-2 sm:px-4">
          {initialAttempt.subjects.map((subject, index) => {
            const stats = subjectStats.find((item) => item.subjectId === subject.id);
            const active = index === currentSubjectIndex;
            return (
              <button
                type="button"
                key={subject.id}
                onClick={() => jumpTo(index, 0)}
                className={`flex-none border-b-2 px-3 py-2.5 text-left transition sm:px-4 ${active ? "border-blue-600 text-slate-950" : "border-transparent text-slate-400"}`}
              >
                <div className="max-w-32 truncate text-xs font-bold">{subject.name}</div>
                <div className="mt-0.5 text-[10px] font-semibold">{stats?.answered ?? 0}/{subject.questionCount}</div>
              </button>
            );
          })}
        </div>
      </div>

      <SyncNotice ready={sync.ready} error={sync.error} code={sync.code} online={online} expired={secondsLeft === 0} onConflict={() => void sync.resolveConflict()} onStorageRetry={() => void sync.retryStorage()} />
      <main className="mx-auto grid max-w-[1280px] gap-5 px-4 pb-28 pt-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_290px] lg:pb-24">
        <div className="mx-auto w-full max-w-3xl lg:mx-0 lg:max-w-none">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-600">{currentSubject.name}</div>
              <div className="mt-1 text-sm font-extrabold">Question {currentQuestion.subjectPosition} of {currentSubject.questionCount}</div>
            </div>
            <button
              type="button"
              disabled={!sync.ready || submitting || secondsLeft === 0}
              onClick={() => queueResponse(currentQuestion.id, { ...currentResponse, isFlagged: !currentResponse.isFlagged })}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold ${currentResponse.isFlagged ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600"}`}
            >
              <Flag className="h-3.5 w-3.5" fill={currentResponse.isFlagged ? "currentColor" : "none"} /> {currentResponse.isFlagged ? "Flagged" : "Flag"}
            </button>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-7">
            {question.passage ? (
              <button type="button" onClick={() => setPassageOpen(true)} className="mb-4 flex w-full items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 text-left">
                <div><div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Comprehension passage</div><div className="mt-1 text-xs font-semibold text-slate-600">Open the passage without losing your answer</div></div>
                <span className="text-xs font-bold text-blue-700">View Passage</span>
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
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={selected}
                    disabled={!sync.ready || submitting || secondsLeft === 0}
              onClick={() => queueResponse(currentQuestion.id, { ...currentResponse, selectedOptionKey: option.key })}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm font-semibold transition ${selected ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-extrabold ${selected ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"}`}>{option.key}</span>
                    <span className="leading-6">{option.text}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => queueResponse(currentQuestion.id, { ...currentResponse, selectedOptionKey: null })}
              disabled={!sync.ready || submitting || secondsLeft === 0 || !currentResponse.selectedOptionKey}
              className="mt-4 text-[11px] font-bold text-slate-400 disabled:opacity-30"
            >
              Clear answer
            </button>
          </section>
          <div className="mt-3 text-center text-[10px] font-semibold text-slate-400">{currentSubjectStats?.answered ?? 0}/{currentSubject.questionCount} answered in {currentSubject.name}</div>
        </div>

        <aside className="hidden lg:block">{renderNavigator(false)}</aside>
      </main>

      <div className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 pb-2 pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-[1fr_auto_1fr] gap-2 lg:max-w-5xl">
          <button type="button" onClick={goPrevious} className="inline-flex h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 text-xs font-extrabold text-slate-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
          <button type="button" onClick={() => setNavigatorOpen(true)} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-4 text-xs font-extrabold text-slate-700 lg:hidden"><Grid3X3 className="h-4 w-4" /> Questions</button>
          <button type="button" onClick={() => setSubmissionOpen(true)} className="hidden h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-4 text-xs font-extrabold text-slate-700 lg:inline-flex"><Send className="h-4 w-4" /> Review</button>
          <button type="button" onClick={goNext} className="inline-flex h-11 items-center justify-center gap-1 rounded-xl bg-blue-600 text-xs font-extrabold text-white">Next <ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {navigatorOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/40 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close navigator" className="absolute inset-0" onClick={() => setNavigatorOpen(false)} />
          <div className="safe-area-bottom absolute inset-x-0 bottom-0 max-h-[86dvh] rounded-t-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div><div className="text-sm font-black text-slate-950">Questions</div><div className="mt-0.5 text-[10px] font-semibold text-slate-400">{answeredTotal} answered · {flaggedTotal} flagged</div></div>
              <button type="button" onClick={() => setNavigatorOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><X className="h-4 w-4" /></button>
            </div>
            {renderNavigator(true)}
          </div>
        </div>
      ) : null}

      {passageOpen && question.passage ? (
        <div className="fixed inset-0 z-[60] bg-white lg:bg-slate-950/40" role="dialog" aria-modal="true">
          <div className="mx-auto flex h-full max-w-2xl flex-col bg-white lg:my-8 lg:h-[calc(100dvh-4rem)] lg:rounded-3xl lg:shadow-2xl">
            <div className="safe-area-top flex items-center justify-between border-b border-slate-100 px-4 pb-3 pt-3">
              <div><div className="text-xs font-extrabold uppercase tracking-[0.14em] text-blue-600">Passage</div><div className="mt-1 text-sm font-bold text-slate-900">{question.passage.title || "Read the passage carefully"}</div></div>
              <button type="button" onClick={() => setPassageOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7"><p className="whitespace-pre-line text-[15px] leading-8 text-slate-700">{question.passage.body}</p></div>
            <div className="safe-area-bottom border-t border-slate-100 p-3"><button type="button" onClick={() => setPassageOpen(false)} className="h-12 w-full rounded-xl bg-slate-950 text-sm font-bold text-white">Back to Question {currentQuestion.subjectPosition}</button></div>
          </div>
        </div>
      ) : null}

      {submissionOpen ? (
        <div className="fixed inset-0 z-[70] bg-slate-950/45" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close submission review" className="absolute inset-0" onClick={() => !submitting && setSubmissionOpen(false)} />
          <div className="safe-area-bottom absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-xs font-extrabold uppercase tracking-[0.15em] text-blue-600">Submission review</div><h2 className="mt-2 text-xl font-black text-slate-950">Check before you submit</h2></div>
              <button type="button" disabled={submitting} onClick={() => setSubmissionOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-emerald-50 p-3 text-center"><div className="text-xl font-black text-emerald-800">{answeredTotal}</div><div className="text-[10px] font-bold text-emerald-700">Answered</div></div>
              <div className="rounded-xl bg-slate-50 p-3 text-center"><div className="text-xl font-black text-slate-800">{unansweredTotal}</div><div className="text-[10px] font-bold text-slate-500">Unanswered</div></div>
              <div className="rounded-xl bg-amber-50 p-3 text-center"><div className="text-xl font-black text-amber-800">{flaggedTotal}</div><div className="text-[10px] font-bold text-amber-700">Flagged</div></div>
            </div>

            <div className="mt-5 space-y-2">
              {initialAttempt.subjects.map((subject) => {
                const stats = subjectStats.find((item) => item.subjectId === subject.id);
                return <div key={subject.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3.5 py-3 text-sm"><span className="font-bold text-slate-800">{subject.name}</span><span className="font-mono text-xs font-bold text-slate-500">{stats?.answered ?? 0}/{subject.questionCount}</span></div>;
              })}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={unansweredTotal === 0 || submitting}
                onClick={() => { const found = findFirst((state) => !state.selectedOptionKey); if (found) jumpTo(found.sIndex, found.qIndex); }}
                className="h-11 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-40"
              >Review Unanswered</button>
              <button
                type="button"
                disabled={flaggedTotal === 0 || submitting}
                onClick={() => { const found = findFirst((state) => state.isFlagged); if (found) jumpTo(found.sIndex, found.qIndex); }}
                className="h-11 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 disabled:opacity-40"
              >Review Flagged</button>
            </div>

            {sync.pendingCount > 0 ? <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">Some recent changes are still waiting to sync. Final submission will wait for them while you are online.</div> : null}

            <button
              type="button"
              disabled={submitting}
              onClick={() => void sync.finish(secondsLeft === 0)}
              className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-extrabold text-white disabled:bg-red-300"
            >
              {submitting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {submitting ? "Submitting…" : "Submit Exam"}
            </button>
            <button type="button" disabled={submitting} onClick={() => setSubmissionOpen(false)} className="mt-2 h-11 w-full text-xs font-bold text-slate-500">Continue Exam</button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => router.push("/mock")}
        className="fixed bottom-[74px] left-2 z-20 hidden items-center gap-1 rounded-lg bg-white/90 px-2 py-1 text-[9px] font-bold text-slate-400 shadow-sm lg:inline-flex"
      >
        <LogOut className="h-3 w-3" /> Save & exit
      </button>
    </div>
  );
}
