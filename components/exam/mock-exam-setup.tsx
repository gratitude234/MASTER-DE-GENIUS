"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileCheck2, Flag, RefreshCcw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { typography } from "@/components/ui/variants";
import type { MockExamSetup } from "@/features/exams/types";
import { cn } from "@/lib/utils";

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
        <div className={cn(typography.eyebrow, "text-brand-600")}>Mock Exam</div>
        <h1 className={cn("mt-2", typography.h1)}>{setup.blueprintName}</h1>
        <p className="mt-1 text-sm text-slate-500">{setup.examName} {setup.examYear} · full multi-subject CBT simulation.</p>
      </div>

      {/*
        Blocking conditions come before any reassurance. Reading five things the
        exam will do for you, then learning it cannot be built, wastes the
        student's time and reads as a bait-and-switch.
      */}
      {canBuildPaper ? null : (
        <InlineAlert tone="warning">
          <strong className="font-bold">This mock cannot be built yet.</strong>{" "}
          {unavailableSubjects.map((subject) => subject.name).join(" and ")}{" "}
          {unavailableSubjects.length === 1 ? "is" : "are"} temporarily unavailable while we expand the question source.
          Practise your other subjects in the meantime — the full mock returns automatically once ready.
        </InlineAlert>
      )}

      {setup.activeAttempt ? (
        <section className="rounded-2xl border border-brand-500/20 bg-brand-50 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-white"><RefreshCcw className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className={cn(typography.eyebrow, "text-brand-600")}>Exam in progress</div>
              <h2 className={cn("mt-1", typography.h2)}>{setup.activeAttempt.examName} mock</h2>
              <p className="mt-1 text-sm text-slate-600">
                {setup.activeAttempt.answeredCount}/{setup.activeAttempt.totalQuestions} answered · {setup.activeAttempt.flaggedCount} flagged · {remainingLabel(setup.activeAttempt.expiresAt)}
              </p>
              <Button
                type="button"
                variant="dark"
                size="md"
                className="mt-4 w-full sm:w-auto sm:min-w-40"
                onClick={() => router.push(`/exam/${setup.activeAttempt!.id}`)}
              >
                Resume exam
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className={cn(typography.eyebrow, "text-slate-500")}>Exam structure</h2>
            <div className="mt-2 text-xl font-black text-slate-950">{setup.totalQuestions} questions</div>
            <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500">
              <Clock3 aria-hidden="true" className="h-4 w-4" /> {formatDuration(setup.durationSeconds)}
            </div>
          </div>
          <div aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><FileCheck2 className="h-5 w-5" /></div>
        </div>

        <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {setup.subjects.map((subject) => (
            <li
              key={subject.id}
              className={cn(
                "rounded-xl border p-3",
                subject.available ? "border-slate-100 bg-slate-50" : "border-warning-200 bg-warning-50",
              )}
            >
              <div className={cn("truncate text-sm font-bold", subject.available ? "text-slate-900" : "text-warning-900")}>
                {subject.name}
              </div>
              {subject.available ? (
                <div className="mt-1 text-xs font-semibold text-slate-500">{subject.questionCount} questions</div>
              ) : (
                <Badge tone="warning" className="mt-1.5">Not available yet</Badge>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className={cn("flex items-center gap-2", typography.h2)}>
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-brand-600" /> Before you begin
        </h2>
        <ul className="mt-4 space-y-3">
          {examConditions.map((condition) => (
            <li key={condition} className="flex items-start gap-2.5 text-sm leading-6 text-slate-600">
              <CheckCircle2 aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-success-600" />
              <span>{condition}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-warning-50 px-3.5 py-3 text-xs leading-5 text-warning-800">
          <Flag aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          Once started, the timer continues even if you close the browser. Returning to MASTER@DE&apos;GENIUS will let you resume the same paper while time remains.
        </p>
      </section>

      {/* The consent gate is unchanged: the start button stays inert until it is ticked. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-500"
        />
        <span><strong className="text-slate-900">I&apos;m ready to begin.</strong> I understand the timer starts immediately and the final submission is irreversible.</span>
      </label>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <Button
        type="button"
        variant="dark"
        size="xl"
        fullWidth
        onClick={startExam}
        disabled={!acknowledged || !canBuildPaper || Boolean(setup.activeAttempt)}
        loading={starting}
        loadingLabel="Building your paper…"
      >
        {setup.activeAttempt ? "Resume the active exam above" : !canBuildPaper ? "Full mock unavailable right now" : "Begin Full Mock"}
      </Button>
    </div>
  );
}
