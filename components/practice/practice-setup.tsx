"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertCircle, ChevronDown, Clock3, Layers3, LoaderCircle, SlidersHorizontal, Sparkles } from "lucide-react";

import type { PracticeCatalogSubject } from "@/features/questions/types";
import type { QuestionDifficulty } from "@/types/domain";

interface PracticeFilterCapabilities {
  years: boolean;
  topics: boolean;
  difficulty: boolean;
}

interface PracticeSetupProps {
  examName: string;
  examYear: number;
  subjects: PracticeCatalogSubject[];
  capabilities: PracticeFilterCapabilities;
  /** Slugs the active question source cannot serve. Never offered for selection. */
  unavailableSubjects: string[];
  resumeSession?: {
    id: string;
    subjectName: string;
    mode: PracticeMode;
    answeredCount: number;
    questionCount: number;
  } | null;
}

type PracticeMode = "practice" | "timed";

export function PracticeSetup({ examName, examYear, subjects, capabilities, unavailableSubjects, resumeSession }: PracticeSetupProps) {
  const router = useRouter();
  const unavailable = useMemo(() => new Set(unavailableSubjects), [unavailableSubjects]);
  const availableSubjects = useMemo(
    () => subjects.filter((subject) => !unavailable.has(subject.slug)),
    [subjects, unavailable],
  );
  const [subjectSlug, setSubjectSlug] = useState(availableSubjects[0]?.slug ?? "");
  const activeSubject = useMemo(
    () => availableSubjects.find((subject) => subject.slug === subjectSlug) ?? availableSubjects[0],
    [subjectSlug, availableSubjects],
  );
  const [topicSlug, setTopicSlug] = useState("all");
  const [questionCount, setQuestionCount] = useState(20);
  const [mode, setMode] = useState<PracticeMode>("practice");
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | "mixed">("mixed");
  const [year, setYear] = useState("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const chooseSubject = (slug: string) => {
    if (unavailable.has(slug)) return;
    setSubjectSlug(slug);
    setTopicSlug("all");
  };

  const startSession = async () => {
    if (!activeSubject || starting) return;
    setStarting(true);
    setStartError(null);

    try {
      const response = await fetch("/api/practice/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectSlug: activeSubject.slug,
          topicSlug: capabilities.topics && topicSlug !== "all" ? topicSlug : null,
          count: questionCount,
          mode,
          difficulty: capabilities.difficulty && difficulty !== "mixed" ? difficulty : null,
          year: capabilities.years && year !== "all" ? Number(year) : null,
        }),
      });
      const payload = (await response.json()) as { sessionId?: string; questionCount?: number; requestedCount?: number; error?: string };
      if (!response.ok || !payload.sessionId) {
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
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        {subjects.length
          ? "None of your subjects can be practised right now while we expand the question source. Please check back shortly."
          : "No subjects are configured for your current exam preference."}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Practice</div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Build a focused session</h1>
        <p className="mt-1 text-sm text-slate-500">{examName} {examYear} · choose what you want to work on.</p>
      </div>

      {resumeSession ? (
        <button
          type="button"
          onClick={() => router.push(`/practice/session/${resumeSession.id}`)}
          className="w-full rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left transition hover:border-blue-300"
        >
          <div className="text-xs font-bold uppercase tracking-[0.15em] text-blue-700">Resume session</div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div>
              <div className="font-bold text-slate-950">{resumeSession.subjectName} · <span className="capitalize">{resumeSession.mode}</span></div>
              <div className="mt-1 text-sm text-slate-600">{resumeSession.answeredCount} of {resumeSession.questionCount} answers saved</div>
            </div>
            <span className="shrink-0 text-sm font-bold text-blue-700">Continue →</span>
          </div>
        </button>
      ) : null}

      <button
        type="button"
        className="w-full rounded-2xl bg-slate-950 p-5 text-left text-white shadow-sm"
        onClick={() => {
          const physics = availableSubjects.find((subject) => subject.slug === "physics") ?? availableSubjects[0];
          chooseSubject(physics.slug);
          setTopicSlug(capabilities.topics ? physics.topics.find((topic) => topic.slug === "waves")?.slug ?? "all" : "all");
          setQuestionCount(20);
          setMode("practice");
        }}
      >
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-white/50">
          <Sparkles className="h-4 w-4" /> Quick practice
        </div>
        <div className="mt-3 text-lg font-bold">{capabilities.topics ? "Recommended weak-area session" : "Recommended quick session"}</div>
        <div className="mt-1 text-sm text-white/60">20 questions · immediate feedback · about 14 minutes</div>
      </button>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="text-sm font-bold text-slate-950">Subject</div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {subjects.map((subject) => {
            const isUnavailable = unavailable.has(subject.slug);
            const active = !isUnavailable && subject.slug === activeSubject.slug;
            return (
              <button
                type="button"
                key={subject.id}
                disabled={isUnavailable}
                aria-disabled={isUnavailable}
                onClick={() => chooseSubject(subject.slug)}
                className={`min-h-12 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  isUnavailable
                    ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                    : active
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {subject.name}
                {isUnavailable ? (
                  <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide">Not available yet</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {unavailable.size ? (
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Some subjects are temporarily unavailable while we expand the question source. They return automatically once ready.
          </p>
        ) : null}
      </section>

      {capabilities.topics ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-950">Topic</div>
              <div className="mt-1 text-xs text-slate-500">Focus on one area or mix the whole subject.</div>
            </div>
            <Layers3 className="h-5 w-5 text-slate-400" />
          </div>
          <select
            value={topicSlug}
            onChange={(event) => setTopicSlug(event.target.value)}
            className="mt-4 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500"
          >
            <option value="all">All topics</option>
            {activeSubject.topics.map((topic) => (
              <option key={topic.id} value={topic.slug}>{topic.name}</option>
            ))}
          </select>
        </section>
      ) : (
        <section className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <Layers3 className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <div>
            <div className="text-sm font-bold text-slate-950">Whole-subject practice</div>
            <div className="mt-1 text-xs text-slate-500">
              Your session covers the full subject. Topic filtering will be available with an expanded question source.
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="text-sm font-bold text-slate-950">Questions</div>
            <div className="mt-3 flex gap-2">
              {[10, 20, 30, 40].map((count) => (
                <button
                  type="button"
                  key={count}
                  onClick={() => setQuestionCount(count)}
                  className={`h-11 flex-1 rounded-xl border text-sm font-bold ${questionCount === count ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-950">Mode</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["practice", "timed"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setMode(value)}
                  className={`h-11 rounded-xl border text-sm font-bold capitalize ${mode === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        {capabilities.years || capabilities.difficulty ? (
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="mt-5 flex w-full items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-slate-600"
          >
            <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Advanced options</span>
            <ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} />
          </button>
        ) : null}

        {advancedOpen ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {capabilities.difficulty ? (
              <label className="text-sm font-semibold text-slate-700">
                Difficulty
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as QuestionDifficulty | "mixed")}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="mixed">Mixed</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
            ) : null}
            {capabilities.years ? (
              <label className="text-sm font-semibold text-slate-700">
                Year
                <select
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="all">All years</option>
                  {Array.from({ length: 10 }, (_, index) => examYear - index).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
        {startError ? (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{startError}</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={startSession}
          disabled={starting}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-base font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
        >
          {starting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Clock3 className="mr-2 h-4 w-4" />}
          {starting ? "Building session…" : `Start ${questionCount}-question session`}
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">Your question set is frozen when the session starts, so refreshes and resumes stay consistent.</p>
      </div>
    </div>
  );
}
