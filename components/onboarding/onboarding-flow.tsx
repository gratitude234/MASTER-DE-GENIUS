"use client";
import { useActionState, useState } from "react";
import { saveExamPreparationsAction } from "@/features/onboarding/actions";
import { initialOnboardingState, type OnboardingExam, type OnboardingSelection } from "@/features/onboarding/types";
import { EXAM_ONBOARDING_RULES, validateTargetScore } from "@/features/onboarding/validation";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { cn } from "@/lib/utils";

type Configuration = NonNullable<OnboardingSelection>;
export function OnboardingFlow({ exams, initialSelection, initialSelections = [] }: {
 exams: OnboardingExam[]; initialSelection: OnboardingSelection; initialSelections?: Configuration[];
}) {
 const saved = initialSelections.length ? initialSelections : initialSelection ? [initialSelection] : [];
 const [selected, setSelected] = useState<string[]>(saved.map(value => value.examCode));
 const [defaultCode, setDefaultCode] = useState(saved[0]?.examCode ?? "jamb");
 const [configurations, setConfigurations] = useState<Record<string, Configuration>>(() => Object.fromEntries(exams.map(exam => [exam.code,
  saved.find(value => value.examCode === exam.code) ?? { examCode: exam.code, examYear: new Date().getFullYear() + 1,
   targetScore: EXAM_ONBOARDING_RULES[exam.code].targetDefault, intendedCourse: "", studyIntensity: "moderate",
   subjectIds: exam.subjects.filter(subject => subject.isCompulsory).map(subject => subject.id) },
 ])));
 const [state, action, pending] = useActionState(saveExamPreparationsAction, initialOnboardingState);
 function update(code: string, patch: Partial<Configuration>) {
  setConfigurations(current => ({ ...current, [code]: { ...current[code], ...patch } }));
 }
 const invalid = !selected.length || selected.some(code => {
  const value = configurations[code], rules = EXAM_ONBOARDING_RULES[value.examCode];
  return validateTargetScore(String(value.targetScore), value.examCode) || value.subjectIds.length < rules.minSubjects || value.subjectIds.length > rules.maxSubjects;
 });
 return <form action={action} className="space-y-5">
  <h1 className="text-2xl font-bold text-slate-950">What are you preparing for?</h1>
  <p className="text-sm text-slate-600">Choose JAMB, WAEC, or both. Each exam has its own subjects and goal.</p>
  <div className="grid grid-cols-2 gap-3">{exams.map(exam => <button key={exam.code} type="button" disabled={!exam.available || pending}
   aria-disabled={saved.some(value => value.examCode === exam.code) || undefined} aria-pressed={selected.includes(exam.code)} className={cn("min-h-16 rounded-2xl border p-4 font-bold", selected.includes(exam.code) ? "border-slate-950 bg-slate-950 text-white" : "bg-white text-slate-800")}
   onClick={() => {
    if (saved.some(value => value.examCode === exam.code)) return;
    const next = selected.includes(exam.code) ? selected.filter(code => code !== exam.code) : [...selected, exam.code];
    setSelected(next); if (!next.includes(defaultCode)) setDefaultCode((next[0] ?? "jamb") as Configuration["examCode"]);
   }}>{exam.shortName}{saved.some(value => value.examCode === exam.code) ? " · Added" : ""}</button>)}</div>
  {selected.map(code => {
   const value = configurations[code], exam = exams.find(exam => exam.code === code)!, rules = EXAM_ONBOARDING_RULES[value.examCode];
   return <fieldset key={code} disabled={pending} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <legend className="px-2 font-bold">{exam.shortName} preparation</legend>
    <p className="text-xs text-slate-600">{code === "jamb" ? "Select exactly four subjects, including Use of English." : "Select one to nine preparation subjects."} {value.subjectIds.length} selected.</p>
    <div className="grid grid-cols-2 gap-2">{exam.subjects.map(subject => <button type="button" key={subject.id} aria-pressed={value.subjectIds.includes(subject.id)} disabled={subject.isCompulsory}
     className={cn("min-h-12 rounded-xl border p-2 text-left text-xs font-semibold", value.subjectIds.includes(subject.id) ? "border-brand-500 bg-brand-50" : "border-slate-200")}
     onClick={() => update(code, { subjectIds: value.subjectIds.includes(subject.id) ? value.subjectIds.filter(id => id !== subject.id) : value.subjectIds.length < rules.maxSubjects ? [...value.subjectIds, subject.id] : value.subjectIds })}>
     {subject.name}{subject.isCompulsory ? " (required)" : ""}</button>)}</div>
    <label className="block text-sm">Exam year<input required type="number" min={new Date().getFullYear()} max={new Date().getFullYear()+4} value={value.examYear} onChange={event => update(code, { examYear: Number(event.target.value) })} className="mt-1 block min-h-11 w-full rounded-lg border p-2" /></label>
    <label className="block text-sm">{code === "waec" ? "Target percentage" : "Target score / 400"}<input required type="number" min={rules.targetMin} max={rules.targetMax} value={value.targetScore} onChange={event => update(code, { targetScore: Number(event.target.value) })} className="mt-1 block min-h-11 w-full rounded-lg border p-2" /></label>
    <label className="block text-sm">Intended course (optional)<input maxLength={120} value={value.intendedCourse ?? ""} onChange={event => update(code, { intendedCourse: event.target.value })} className="mt-1 block min-h-11 w-full rounded-lg border p-2" /></label>
    <label className="block text-sm">Study intensity<select value={value.studyIntensity ?? "moderate"} onChange={event => update(code, { studyIntensity: event.target.value as Configuration["studyIntensity"] })} className="mt-1 block min-h-11 w-full rounded-lg border p-2">
      <option value="light">Light</option><option value="moderate">Moderate</option><option value="intensive">Intensive</option>
    </select></label>
   </fieldset>;
  })}
  {selected.length > 1 ? <label className="block text-sm font-semibold">Which exam should open first when you sign in?<select name="defaultCode" value={defaultCode} onChange={event => setDefaultCode(event.target.value as Configuration["examCode"])} className="mt-2 min-h-12 w-full rounded-xl border p-3">{selected.map(code => <option key={code} value={code}>{code.toUpperCase()}</option>)}</select></label> : <input type="hidden" name="defaultCode" value={selected[0] ?? ""} />}
  <input type="hidden" name="configurations" value={JSON.stringify(selected.map(code => configurations[code]))} />
  {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
  <Button variant="dark" size="lg" fullWidth disabled={Boolean(invalid)} loading={pending}>Save my preparation</Button>
 </form>;
}
