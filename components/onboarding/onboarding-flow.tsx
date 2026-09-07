"use client";

import { useActionState, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Target } from "lucide-react";
import { completeOnboardingAction } from "@/features/onboarding/actions";
import { initialOnboardingState, type OnboardingSubject } from "@/features/onboarding/types";
import { TARGET_SCORE_MAX, TARGET_SCORE_MIN, validateTargetScore } from "@/features/onboarding/validation";
import { AuthField } from "@/components/auth/auth-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

const steps = [
  { number: 1, label: "Choose your exam" },
  { number: 2, label: "Choose your subjects" },
  { number: 3, label: "Set your goal" },
] as const;

const intensityOptions = [
  { id: "light", label: "Light", detail: "A little each day" },
  { id: "moderate", label: "Moderate", detail: "Balanced preparation" },
  { id: "intensive", label: "Intensive", detail: "High-focus preparation" },
] as const;

function defaultSubjectSelection(subjects: OnboardingSubject[]) {
  const preferred = ["use-of-english", "mathematics", "physics", "chemistry"];
  const selected = preferred.map((slug) => subjects.find((subject) => subject.slug === slug)?.id).filter((id): id is string => Boolean(id));
  for (const subject of subjects) {
    if (selected.length >= 4) break;
    if (!selected.includes(subject.id)) selected.push(subject.id);
  }
  return selected.slice(0, 4);
}

export function OnboardingFlow({ subjects }: { subjects: OnboardingSubject[] }) {
  const [step, setStep] = useState(1);
  const [selectedSubjects, setSelectedSubjects] = useState(() => defaultSubjectSelection(subjects));
  const [targetScore, setTargetScore] = useState("280");
  const [state, action, pending] = useActionState(completeOnboardingAction, initialOnboardingState);
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2];
  const compulsoryId = useMemo(() => subjects.find((subject) => subject.isCompulsory)?.id, [subjects]);
  const targetScoreError = validateTargetScore(targetScore);

  function toggleSubject(id: string) {
    if (id === compulsoryId) return;
    setSelectedSubjects((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 4) return current;
      return [...current, id];
    });
  }

  return (
    <form action={action} className="mx-auto w-full max-w-3xl">
      <ol aria-label="Onboarding progress" className="mb-7 flex items-center gap-2">
        {steps.map(({ number, label }) => (
          <li key={number} className="flex-1" aria-current={step === number ? "step" : undefined}>
            <span aria-hidden="true" className={cn("block h-1.5 rounded-full", number <= step ? "bg-slate-950" : "bg-slate-200")} />
            <span className="sr-only">{`Step ${number} of ${steps.length}: ${label}${step === number ? " — current step" : ""}`}</span>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="mx-auto max-w-xl text-center">
            <div aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-500"><Target className="h-6 w-6" /></div>
            <h1 className={cn("mt-5", typography.h1)}>What are you preparing for?</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">We&apos;ll shape your dashboard and practice around your exam.</p>
          </div>
          {/*
            JAMB is the only live exam body, so this is a statement of what is
            selected rather than a choice. It was a <button> that did nothing —
            a focus stop that never rewarded the keyboard user who reached it.
          */}
          <div className="mt-7 w-full rounded-2xl border-2 border-slate-950 bg-slate-50 p-5 text-left">
            <div className="flex items-center justify-between gap-4">
              <div><div className="text-lg font-black text-slate-950">JAMB / UTME</div><div className="mt-1 text-sm text-slate-500">Full practice, mock exams and performance tracking</div></div>
              <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-950 text-white"><Check className="h-4 w-4" /></span>
            </div>
            <Badge tone="brand" dot className="mt-3">Selected</Badge>
          </div>
          {/*
            Supporting copy, not a status chip: at 360px a Badge here would wrap
            inside its own pill. Only the contrast changes — slate-400 on
            slate-50 did not carry.
          */}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-500">
            {["WAEC", "NECO", "Post-UTME", "School Exams"].map((item) => (
              <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="font-bold text-slate-600">{item}</span>
                <div className="mt-0.5 text-[11px]">Coming in a later phase</div>
              </div>
            ))}
          </div>
          <Button type="button" variant="dark" size="lg" fullWidth className="mt-7" onClick={() => setStep(2)} iconAfter={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
            Choose subjects
          </Button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h1 className={typography.h1}>Choose your JAMB subjects</h1>
          <p className="mt-2 text-sm text-slate-500">Select exactly four subjects. Use of English is compulsory.</p>
          <p aria-live="polite" className="mt-3 text-xs font-bold text-brand-500">{selectedSubjects.length} of 4 selected</p>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {subjects.map((subject) => {
              const selected = selectedSubjects.includes(subject.id);
              return (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => toggleSubject(subject.id)}
                  aria-pressed={selected}
                  aria-disabled={subject.isCompulsory || undefined}
                  className={cn(
                    "flex min-h-14 items-center justify-between rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                    selected ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <span className="text-sm font-bold text-slate-800">{subject.name}</span>
                  {subject.isCompulsory ? (
                    <>
                      <span className="sr-only">Compulsory, always included</span>
                      <LockKeyhole aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
                    </>
                  ) : (
                    <span aria-hidden="true" className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border", selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300")}>{selected ? <Check className="h-3 w-3" /> : null}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-7 flex gap-3">
            <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={() => setStep(1)} iconBefore={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
              Back
            </Button>
            <Button type="button" variant="dark" size="lg" className="flex-[1.4]" disabled={selectedSubjects.length !== 4} onClick={() => setStep(3)} iconAfter={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
              Set your goal
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h1 className={typography.h1}>Set your goal</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">This helps MASTER@DE&apos;GENIUS personalize your preparation.</p>
          {selectedSubjects.map((id) => <input key={id} type="hidden" name="subjectIds" value={id} />)}
          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="onboarding-exam-year" className="block text-xs font-bold text-slate-700">JAMB exam year</label>
              <Select id="onboarding-exam-year" name="examYear" defaultValue={String(currentYear + 1)} containerClassName="mt-1.5">
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </Select>
            </div>

            <AuthField
              label="Target score"
              name="targetScore"
              type="number"
              inputMode="numeric"
              min={TARGET_SCORE_MIN}
              max={TARGET_SCORE_MAX}
              step={5}
              value={targetScore}
              onChange={(event) => setTargetScore(event.target.value)}
              hint={targetScoreError ? undefined : `Between ${TARGET_SCORE_MIN} and ${TARGET_SCORE_MAX}`}
              error={targetScoreError}
              className="font-semibold"
            />

            <AuthField label="Intended course" name="intendedCourse" maxLength={120} placeholder="e.g. Electrical Engineering" hint="Optional" />

            <fieldset className="border-0 p-0">
              <legend className="text-xs font-bold text-slate-700">Preferred study intensity</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {intensityOptions.map((option) => (
                  <label key={option.id} className="cursor-pointer">
                    <input className="peer sr-only" type="radio" name="studyIntensity" value={option.id} defaultChecked={option.id === "moderate"} />
                    <span className="block rounded-xl border border-slate-200 px-2 py-3 text-center peer-checked:border-slate-950 peer-checked:bg-slate-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2">
                      <span className="block text-xs font-extrabold text-slate-800">{option.label}</span>
                      <span className="mt-1 hidden text-[10px] leading-4 text-slate-500 sm:block">{option.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {state.error ? <div className="mt-5"><InlineAlert tone="danger">{state.error}</InlineAlert></div> : null}
          <div className="mt-7 flex gap-3">
            <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={() => setStep(2)} iconBefore={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
              Back
            </Button>
            {/* No `type`: this is the form's submit control. */}
            <Button variant="primary" size="lg" className="flex-[1.6]" disabled={Boolean(targetScoreError)} loading={pending} loadingLabel="Building your dashboard…">
              Build my study dashboard
            </Button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
