"use client";

import { useActionState, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Target } from "lucide-react";
import { completeOnboardingAction } from "@/features/onboarding/actions";
import { initialOnboardingState, type OnboardingExam, type OnboardingExamCode, type OnboardingSelection } from "@/features/onboarding/types";
import { EXAM_ONBOARDING_RULES, validateTargetScore } from "@/features/onboarding/validation";
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

const laterExams = [
  { name: "NECO", status: "Limited question coverage — not available yet" },
  { name: "Post-UTME", status: "Coming in a later phase" },
  { name: "School Exams", status: "Coming in a later phase" },
] as const;

function defaultSubjectSelection(exam: OnboardingExam) {
  if (exam.code === "waec") return [];
  const preferred = ["use-of-english", "mathematics", "physics", "chemistry"];
  const selected = preferred.map((slug) => exam.subjects.find((subject) => subject.slug === slug)?.id).filter((id): id is string => Boolean(id));
  for (const subject of exam.subjects) {
    if (selected.length >= 4) break;
    if (!selected.includes(subject.id)) selected.push(subject.id);
  }
  return selected.slice(0, 4);
}

function examDetail(exam: OnboardingExam) {
  return exam.code === "jamb"
    ? "Full practice, mock exams and performance tracking"
    : "Objective practice, past questions and timed subject sessions";
}

export function OnboardingFlow({ exams, initialSelection }: { exams: OnboardingExam[]; initialSelection: OnboardingSelection }) {
  const firstAvailable = exams.find((exam) => exam.available) ?? exams[0];
  const initialExam = exams.find((exam) => exam.code === initialSelection?.examCode && exam.available) ?? firstAvailable;
  const [step, setStep] = useState(1);
  const [examCode, setExamCode] = useState<OnboardingExamCode>(initialExam?.code ?? "jamb");
  const activeExam = useMemo(() => exams.find((exam) => exam.code === examCode) ?? firstAvailable, [examCode, exams, firstAvailable]);
  const initialSubjectIds = initialSelection?.examCode === initialExam?.code
    ? initialSelection.subjectIds.filter((id) => initialExam.subjects.some((subject) => subject.id === id))
    : [];
  const [selectedSubjects, setSelectedSubjects] = useState(() => initialSubjectIds.length ? initialSubjectIds : initialExam ? defaultSubjectSelection(initialExam) : []);
  const [targetScore, setTargetScore] = useState(() => String(initialSelection?.examCode === initialExam?.code ? initialSelection.targetScore : EXAM_ONBOARDING_RULES[initialExam?.code ?? "jamb"].targetDefault));
  const [state, action, pending] = useActionState(completeOnboardingAction, initialOnboardingState);
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2];
  const rules = EXAM_ONBOARDING_RULES[examCode];
  const compulsoryIds = useMemo(() => new Set(activeExam?.subjects.filter((subject) => subject.isCompulsory).map((subject) => subject.id) ?? []), [activeExam]);
  const targetScoreError = validateTargetScore(targetScore, examCode);
  const subjectSelectionValid = selectedSubjects.length >= rules.minSubjects && selectedSubjects.length <= rules.maxSubjects;

  function chooseExam(nextExam: OnboardingExam) {
    if (!nextExam.available || nextExam.code === examCode) return;
    setExamCode(nextExam.code);
    const saved = initialSelection?.examCode === nextExam.code
      ? initialSelection.subjectIds.filter((id) => nextExam.subjects.some((subject) => subject.id === id))
      : [];
    setSelectedSubjects(saved.length ? saved : defaultSubjectSelection(nextExam));
    setTargetScore(String(initialSelection?.examCode === nextExam.code ? initialSelection.targetScore : EXAM_ONBOARDING_RULES[nextExam.code].targetDefault));
  }

  function toggleSubject(id: string) {
    if (compulsoryIds.has(id)) return;
    setSelectedSubjects((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= rules.maxSubjects) return current;
      return [...current, id];
    });
  }

  if (!activeExam) {
    return <InlineAlert tone="danger">No examination is currently available. Apply the latest catalogue migration and try again.</InlineAlert>;
  }

  const subjectInstruction = examCode === "jamb"
    ? "Use of English is compulsory. Pick three more."
    : "Choose the WAEC subjects you want to prepare for. You can select up to nine.";
  const subjectCountLabel = examCode === "jamb"
    ? `${selectedSubjects.length} of 4 selected`
    : `${selectedSubjects.length} selected · up to 9`;

  return (
    <form action={action} className="w-full">
      <input type="hidden" name="examCode" value={examCode} />
      <ol aria-label="Onboarding progress" className="mb-6 flex items-center gap-1.5">
        {steps.map(({ number, label }) => (
          <li key={number} className="flex-1" aria-current={step === number ? "step" : undefined}>
            <span aria-hidden="true" className={cn("block h-[5px] rounded-full", number <= step ? "bg-slate-950" : "bg-slate-200")} />
            <span className="sr-only">{`Step ${number} of ${steps.length}: ${label}${step === number ? " — current step" : ""}`}</span>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 sm:px-8 sm:py-9">
          <div className="mx-auto max-w-xl text-center">
            <div aria-hidden="true" className="mx-auto grid h-[52px] w-[52px] place-items-center rounded-2xl bg-brand-50 text-brand-500"><Target className="h-[22px] w-[22px]" /></div>
            <h1 className={cn("mt-5", typography.h1)}>What are you preparing for?</h1>
            <p className="mt-2 text-[13.5px] leading-[1.5] text-slate-600">Your dashboard and practice sets shape around this exam.</p>
          </div>
          <div className="mt-6 grid gap-2.5">
            {exams.map((exam) => {
              const selected = exam.code === examCode;
              return (
                <button
                  key={exam.code}
                  type="button"
                  disabled={!exam.available}
                  aria-pressed={selected}
                  onClick={() => chooseExam(exam)}
                  className={cn(
                    "w-full rounded-2xl border p-[18px] text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                    !exam.available ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500" : selected ? "border-2 border-slate-950 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-400",
                  )}
                >
                  <span className="flex items-center justify-between gap-4">
                    <span><span className="block text-base font-bold text-slate-950">{exam.code === "jamb" ? "JAMB / UTME" : "WAEC / WASSCE"}</span><span className="mt-0.5 block text-[12.5px] leading-[1.5] text-slate-600">{exam.available ? examDetail(exam) : "Question coverage is not active for the current source."}</span></span>
                    {selected ? <span aria-hidden="true" className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-slate-950 text-white"><Check className="h-3.5 w-3.5" /></span> : null}
                  </span>
                  {selected ? <Badge tone="brand" dot className="mt-3">Selected</Badge> : exam.available ? <Badge tone="neutral" className="mt-3">Available</Badge> : <Badge tone="neutral" className="mt-3">Unavailable</Badge>}
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            {laterExams.map((item) => (
              <div key={item.name} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-left text-slate-500">
                <span className="text-[13px] font-semibold text-slate-600">{item.name}</span>
                <div className="mt-0.5 text-[10.5px]">{item.status}</div>
              </div>
            ))}
          </div>
          <Button type="button" variant="dark" size="lg" fullWidth className="mt-6" disabled={!activeExam.available} onClick={() => setStep(2)} iconAfter={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
            Choose subjects
          </Button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 sm:px-7">
          <Badge tone="brand" className="mb-3">{activeExam.shortName}</Badge>
          <h1 className={typography.h1}>Choose your subjects</h1>
          <p className="mt-1.5 text-[13px] leading-[1.5] text-slate-600">{subjectInstruction}</p>
          <p aria-live="polite" className="mt-3 text-xs font-bold text-brand-500">{subjectCountLabel}</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {activeExam.subjects.map((subject) => {
              const selected = selectedSubjects.includes(subject.id);
              return (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => toggleSubject(subject.id)}
                  aria-pressed={selected}
                  aria-disabled={subject.isCompulsory || undefined}
                  className={cn(
                    "flex min-h-[50px] items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                    selected ? "border-[1.5px] border-slate-950 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300",
                  )}
                >
                  <span className="min-w-0 text-[13px] font-semibold text-slate-800">{subject.name}</span>
                  {subject.isCompulsory ? (
                    <><span className="sr-only">Compulsory, always included</span><LockKeyhole aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" /></>
                  ) : (
                    <span aria-hidden="true" className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border", selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300")}>{selected ? <Check className="h-3 w-3" /> : null}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex gap-2.5">
            <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={() => setStep(1)} iconBefore={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>Back</Button>
            <Button type="button" variant="dark" size="lg" className="flex-[1.5]" disabled={!subjectSelectionValid} onClick={() => setStep(3)} iconAfter={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>Set your goal</Button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 sm:px-7">
          <Badge tone="brand" className="mb-3">{activeExam.shortName}</Badge>
          <h1 className={typography.h1}>Set your goal</h1>
          <p className="mt-1.5 text-[13px] leading-[1.5] text-slate-600">Helps us personalise your preparation.</p>
          {selectedSubjects.map((id) => <input key={id} type="hidden" name="subjectIds" value={id} />)}
          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="onboarding-exam-year" className="block text-xs font-semibold text-slate-800">{activeExam.shortName} exam year</label>
              <Select id="onboarding-exam-year" name="examYear" defaultValue={String(initialSelection?.examCode === examCode ? initialSelection.examYear : currentYear + 1)} containerClassName="mt-1.5">
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </Select>
            </div>
            <AuthField
              label={examCode === "waec" ? "Target percentage" : "Target score"}
              name="targetScore" type="number" inputMode="numeric"
              min={rules.targetMin} max={rules.targetMax} step={rules.targetStep}
              value={targetScore} onChange={(event) => setTargetScore(event.target.value)}
              hint={targetScoreError ? undefined : examCode === "waec" ? "Between 1% and 100%" : "Between 180 and 400"}
              error={targetScoreError} className="font-semibold"
            />
            <AuthField label="Intended course" name="intendedCourse" maxLength={120} placeholder="e.g. Electrical Engineering" hint="Optional" />
            <fieldset className="border-0 p-0">
              <legend className="text-xs font-semibold text-slate-800">Preferred study intensity</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {intensityOptions.map((option) => (
                  <label key={option.id} className="cursor-pointer">
                    <input className="peer sr-only" type="radio" name="studyIntensity" value={option.id} defaultChecked={option.id === "moderate"} />
                    <span className="block rounded-xl border border-slate-200 px-2 py-3 text-center peer-checked:border-[1.5px] peer-checked:border-slate-950 peer-checked:bg-slate-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2">
                      <span className="block text-xs font-bold text-slate-800">{option.label}</span>
                      <span className="mt-1 hidden text-[10px] leading-4 text-slate-500 sm:block">{option.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {state.error ? <div className="mt-5"><InlineAlert tone="danger">{state.error}</InlineAlert></div> : null}
          <div className="mt-6 flex gap-2.5">
            <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={() => setStep(2)} iconBefore={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>Back</Button>
            <Button variant="dark" size="lg" className="flex-[1.6]" disabled={Boolean(targetScoreError)} loading={pending} loadingLabel="Building your dashboard…">Build my dashboard</Button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
