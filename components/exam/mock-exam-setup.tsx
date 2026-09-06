"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Flag,
  LoaderCircle,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";

import type { MockExamSetup } from "@/features/exams/types";

interface MockExamSetupProps {
  setup: MockExamSetup;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${minutes} minutes`;
}

function remainingLabel(expiresAt: string) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m remaining` : `${Math.max(1, minutes)}m remaining`;
}

export function MockExamSetup({ setup }: MockExamSetupProps) {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unavailableSubjects = useMemo(
    () => setup.subjects.filter((subject) => !subject.available),
    [setup.subjects],
  );
  const canBuildPaper = unavailableSubjects.length === 0;

  const examConditions = useMemo(() => [
    `${formatDuration(setup.durationSeconds)} total time`,
    "Answers save automatically as you work",
    "You can switch subjects and flag questions for review",
    "The paper is frozen when you start and stays identical after refresh",
    "The server controls the timer and auto-submits when time expires",
  ], [setup.durationSeconds]);

  const startExam = async () => {
    if (!acknowledged || starting || !canBuildPaper) return;
    setStarting(true);
    setError(null);

    try {
      const response = await fetch("/api/exam/attempts", { method: "POST" });
      const payload = await response.json() as { attemptId?: string; error?: string };
      if (!response.ok || !payload.attemptId) throw new Error(payload.error || "Could not start mock exam.");
      router.push(`/exam/${payload.attemptId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start mock exam.");
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Mock Exam</div>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{setup.blueprintName}</h1>
        <p className="mt-1 text-sm text-slate-500">{setup.examName} {setup.examYear} · full multi-subject CBT simulation.</p>
      </div>

      {setup.activeAttempt ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white"><RefreshCcw className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Exam in progress</div>
              <div className="mt-1 text-lg font-bold text-slate-950">{setup.activeAttempt.examName} mock</div>
              <div className="mt-1 text-sm text-slate-600">
                {setup.activeAttempt.answeredCount}/{setup.activeAttempt.totalQuestions} answered · {setup.activeAttempt.flaggedCount} flagged · {remainingLabel(setup.activeAttempt.expiresAt)}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/exam/${setup.activeAttempt!.id}`)}
                className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-bold text-white sm:w-auto sm:min-w-40"
              >
                Resume Exam
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Exam structure</div>
            <div className="mt-2 text-xl font-black text-slate-950">{setup.totalQuestions} questions</div>
            <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500"><Clock3 className="h-4 w-4" /> {formatDuration(setup.durationSeconds)}</div>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 text-blue-600"><FileCheck2 className="h-5 w-5" /></div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {setup.subjects.map((subject) => (
            <div
              key={subject.id}
              className={`rounded-xl border p-3 ${subject.available ? "border-slate-100 bg-slate-50" : "border-amber-200 bg-amber-50"}`}
            >
              <div className={`truncate text-sm font-bold ${subject.available ? "text-slate-900" : "text-amber-900"}`}>{subject.name}</div>
              <div className={`mt-1 text-xs font-semibold ${subject.available ? "text-slate-400" : "text-amber-700"}`}>
                {subject.available ? `${subject.questionCount} questions` : "Not available yet"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-950"><ShieldCheck className="h-4 w-4 text-blue-600" /> Before you begin</div>
        <div className="mt-4 space-y-3">
          {examConditions.map((condition) => (
            <div key={condition} className="flex items-start gap-2.5 text-sm leading-6 text-slate-600">
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{condition}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800">
          <Flag className="mt-0.5 h-4 w-4 shrink-0" />
          Once started, the timer continues even if you close the browser. Returning to MASTER@DE&apos;GENIUS will let you resume the same paper while time remains.
        </div>
      </section>

      {canBuildPaper ? null : (
        <section className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm leading-6 text-amber-900">
          <AlertCircle className="mt-1 h-4 w-4 shrink-0" />
          <span>
            <strong className="font-bold">This mock cannot be built yet.</strong>{" "}
            {unavailableSubjects.map((subject) => subject.name).join(" and ")}{" "}
            {unavailableSubjects.length === 1 ? "is" : "are"} temporarily unavailable while we expand the question source.
            Practice your other subjects in the meantime — the full mock returns automatically once ready.
          </span>
        </section>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-blue-600"
        />
        <span><strong className="text-slate-900">I&apos;m ready to begin.</strong> I understand the timer starts immediately and the final submission is irreversible.</span>
      </label>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={startExam}
        disabled={!acknowledged || starting || !canBuildPaper || Boolean(setup.activeAttempt)}
        className="flex h-[52px] min-h-[52px] w-full items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-extrabold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {starting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
        {setup.activeAttempt ? "Resume the active exam above" : !canBuildPaper ? "Full mock unavailable right now" : starting ? "Building your paper…" : "Begin Full Mock"}
      </button>
    </div>
  );
}
