"use client";

import { useActionState, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Target } from "lucide-react";
import { completeOnboardingAction } from "@/features/onboarding/actions";
import { initialOnboardingState, type OnboardingSubject } from "@/features/onboarding/types";
import { cn } from "@/lib/utils";

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
  const [state, action, pending] = useActionState(completeOnboardingAction, initialOnboardingState);
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2];
  const compulsoryId = useMemo(() => subjects.find((subject) => subject.isCompulsory)?.id, [subjects]);

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
      <div className="mb-7 flex items-center gap-2">
        {[1, 2, 3].map((item) => <div key={item} className={cn("h-1.5 flex-1 rounded-full", item <= step ? "bg-slate-950" : "bg-slate-200")} />)}
      </div>

      {step === 1 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-500"><Target className="h-6 w-6" /></div>
            <h1 className="mt-5 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">What are you preparing for?</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">We&apos;ll shape your dashboard and practice around your exam.</p>
          </div>
          <button type="button" className="mt-7 w-full rounded-2xl border-2 border-slate-950 bg-slate-50 p-5 text-left">
            <div className="flex items-center justify-between gap-4">
              <div><div className="text-lg font-black text-slate-950">JAMB / UTME</div><div className="mt-1 text-sm text-slate-500">Full practice, mock exams and performance tracking</div></div>
              <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-950 text-white"><Check className="h-4 w-4" /></span>
            </div>
          </button>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-400">
            {["WAEC", "NECO", "Post-UTME", "School Exams"].map((item) => <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><span className="font-bold text-slate-500">{item}</span><div className="mt-0.5 text-[11px]">Coming in a later phase</div></div>)}
          </div>
          <button type="button" onClick={() => setStep(2)} className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-extrabold text-white">Choose subjects <ArrowRight className="h-4 w-4" /></button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h1 className="text-2xl font-black tracking-[-0.04em] text-slate-950">Choose your JAMB subjects</h1>
          <p className="mt-2 text-sm text-slate-500">Select exactly four subjects. Use of English is compulsory.</p>
          <div className="mt-3 text-xs font-bold text-brand-500">{selectedSubjects.length} of 4 selected</div>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {subjects.map((subject) => {
              const selected = selectedSubjects.includes(subject.id);
              return (
                <button key={subject.id} type="button" onClick={() => toggleSubject(subject.id)} className={cn("flex min-h-14 items-center justify-between rounded-xl border px-4 py-3 text-left transition", selected ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300")}>
                  <span className="text-sm font-bold text-slate-800">{subject.name}</span>
                  {subject.isCompulsory ? <LockKeyhole className="h-4 w-4 text-slate-400" /> : <span className={cn("grid h-5 w-5 place-items-center rounded-full border", selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300")}>{selected ? <Check className="h-3 w-3" /> : null}</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-7 flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700"><ArrowLeft className="h-4 w-4" /> Back</button>
            <button type="button" disabled={selectedSubjects.length !== 4} onClick={() => setStep(3)} className="flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-extrabold text-white disabled:opacity-40">Set your goal <ArrowRight className="h-4 w-4" /></button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h1 className="text-2xl font-black tracking-[-0.04em] text-slate-950">Set your goal</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">This helps MASTER@DE&apos;GENIUS personalize your preparation.</p>
          {selectedSubjects.map((id) => <input key={id} type="hidden" name="subjectIds" value={id} />)}
          <div className="mt-6 space-y-5">
            <label className="block"><span className="text-xs font-bold text-slate-700">JAMB exam year</span><select name="examYear" defaultValue={String(currentYear + 1)} className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold outline-none focus:border-brand-500">{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
            <label className="block"><span className="text-xs font-bold text-slate-700">Target score</span><input name="targetScore" type="number" min={180} max={400} step={5} defaultValue={280} className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 px-3.5 text-sm font-semibold outline-none focus:border-brand-500" /><span className="mt-1 block text-[11px] text-slate-400">Between 180 and 400</span></label>
            <label className="block"><span className="text-xs font-bold text-slate-700">Intended course <span className="font-medium text-slate-400">(optional)</span></span><input name="intendedCourse" maxLength={120} placeholder="e.g. Electrical Engineering" className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 px-3.5 text-sm outline-none focus:border-brand-500" /></label>
            <div><div className="text-xs font-bold text-slate-700">Preferred study intensity</div><div className="mt-2 grid grid-cols-3 gap-2">{intensityOptions.map((option) => <label key={option.id} className="cursor-pointer"><input className="peer sr-only" type="radio" name="studyIntensity" value={option.id} defaultChecked={option.id === "moderate"} /><span className="block rounded-xl border border-slate-200 px-2 py-3 text-center peer-checked:border-slate-950 peer-checked:bg-slate-50"><span className="block text-xs font-extrabold text-slate-800">{option.label}</span><span className="mt-1 hidden text-[10px] leading-4 text-slate-400 sm:block">{option.detail}</span></span></label>)}</div></div>
          </div>
          {state.error ? <div className="mt-5 rounded-xl bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700">{state.error}</div> : null}
          <div className="mt-7 flex gap-3">
            <button type="button" onClick={() => setStep(2)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700"><ArrowLeft className="h-4 w-4" /> Back</button>
            <button disabled={pending} className="h-12 flex-[1.6] rounded-xl bg-brand-500 text-sm font-extrabold text-white disabled:opacity-60">{pending ? "Building dashboard…" : "Build my study dashboard"}</button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
