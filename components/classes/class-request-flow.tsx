"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, MessageCircle } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { buttonClasses } from "@/components/ui/variants";
import { CLASS_TYPES, CLASS_TYPE_LABELS, type ClassLeadSource, type ClassType, type RecommendationReason } from "@/features/classes/types";
import { leadReference, studentFollowUpMessage, whatsappUrl } from "@/features/classes/whatsapp";
import { track } from "@/features/analytics/events";
import type { ClassCatalogueSubject } from "@/features/classes/service";

interface Props {
  subjects: ClassCatalogueSubject[];
  studentName: string;
  email: string;
  defaultPhone?: string;
  initialOpen?: boolean;
  initialExamType: "jamb" | "waec";
  initialSubjectSlug?: string;
  initialTopic?: string;
  source?: ClassLeadSource;
  recommendationReason?: RecommendationReason;
  recentAccuracy?: number | null;
}

const field = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-950 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15";

/**
 * Structured instead of free text: a student answers with one tap rather than
 * composing a sentence, and Academic Support gets something it can filter on.
 */
const SCHEDULE_OPTIONS = ["Weekday evenings", "Weekday afternoons", "Weekends", "Flexible / anytime"] as const;
const DEFAULT_SCHEDULE = "Flexible / anytime";

/** Accepts spaces and punctuation while typing, and judges only the digits. */
function normalise(value: string) {
  return value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

export function ClassRequestFlow(props: Props) {
  const [open, setOpen] = useState(Boolean(props.initialOpen));
  const [step, setStep] = useState<1 | 2>(1);
  const [subjectSlug, setSubjectSlug] = useState(props.initialSubjectSlug && props.subjects.some((s) => s.slug === props.initialSubjectSlug) ? props.initialSubjectSlug : props.subjects[0]?.slug ?? "");
  const [topic, setTopic] = useState(props.initialTopic ?? "");
  const [classType, setClassType] = useState<ClassType>(props.initialTopic ? "topic_clinic" : "not_sure");
  const [phone, setPhone] = useState(props.defaultPhone ?? "");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [schedule, setSchedule] = useState<string>(DEFAULT_SCHEDULE);
  const [callInstead, setCallInstead] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const formId = useId();

  const selected = useMemo(() => props.subjects.find((subject) => subject.slug === subjectSlug), [props.subjects, subjectSlug]);
  const phoneValid = /^\+?\d{10,15}$/.test(normalise(phone));
  const firstName = props.studentName.trim().split(/\s+/)[0] || "there";
  const whatsapp = reference
    ? whatsappUrl(studentFollowUpMessage({ firstName, subjectName: selected?.name, reference }), process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER?.replace(/\D/g, "") || null)
    : null;

  const close = () => { setOpen(false); setStep(1); setReference(null); setError(null); };
  const startOver = () => { setStep(1); setReference(null); setError(null); };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || submitting || !phoneValid) return;
    setSubmitting(true); setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/classes/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        studentName: data.get("studentName"), email: data.get("email"), phone: normalise(phone),
        examType: props.initialExamType, subjectSlug: selected.slug, subjectName: selected.name,
        topic, classType, preferredContactMethod: callInstead ? "phone" : "whatsapp",
        preferredSchedule: schedule, message: data.get("message"),
        source: props.source ?? "class_page", recommendationReason: props.recommendationReason ?? "student_requested",
        recentAccuracy: props.recentAccuracy ?? null,
        promotionalWhatsappConsent: data.get("promotionalWhatsappConsent") === "on",
        promotionalEmailConsent: data.get("promotionalEmailConsent") === "on",
      }) });
      const payload = await response.json() as { id?: string; error?: string; deduplicated?: boolean };
      if (!response.ok || !payload.id) throw new Error(payload.error || "Could not submit your request.");
      track("class_request_submitted", { source: props.source ?? "class_page", classType, subjectSlug: selected.slug, deduplicated: Boolean(payload.deduplicated) });
      setReference(leadReference(payload.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit your request."); }
    finally { setSubmitting(false); }
  };

  return <>
    <Button type="button" size="lg" onClick={() => { setOpen(true); setStep(1); track("class_request_started", { source: props.source ?? "class_page", subjectSlug, reason: props.recommendationReason ?? "student_requested" }); }}>Request a Class</Button>
    <Sheet
      open={open}
      onClose={close}
      title={reference ? "Request received" : "Request a Master Class"}
      description={reference ? undefined : step === 1 ? "First, what would you like help with?" : "Last step. How should Academic Support reach you?"}
      size="lg"
      dismissible={!submitting}
    >
      {reference ? (
        <div className="py-5 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success-600" aria-hidden="true" />
          <h3 className="mt-4 font-serif text-2xl font-semibold text-slate-950">Your class request has been received.</h3>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-slate-600">Academic Support will reach you on the number you gave us, usually within a day.</p>
          <p className="mt-3 text-[11.5px] font-semibold text-slate-500">Your reference: <span className="mono-number text-slate-950">{reference}</span></p>
          <div className="mt-6 space-y-2">
            {whatsapp ? <a onClick={() => track("class_whatsapp_clicked", { subjectSlug: selected?.slug ?? null })} href={whatsapp} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "primary", size: "lg", fullWidth: true })}><MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />Message us on WhatsApp now</a> : null}
            <Link href="/classes" onClick={close} className={buttonClasses({ variant: "ghost", size: "md", fullWidth: true })}>Back to Classes</Link>
          </div>
          {whatsapp ? <p className="mx-auto mt-3 max-w-sm text-[11px] leading-4 text-slate-500">Sending a message is optional. It just gets you a faster reply.</p> : null}
        </div>
      ) : step === 1 ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-800">Exam<span className="mt-1.5 flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700">{props.initialExamType.toUpperCase()}</span></label>
            <label className="text-xs font-semibold text-slate-800">Subject<Select value={subjectSlug} onChange={(e) => { setSubjectSlug(e.target.value); setTopic(""); }} containerClassName="mt-1.5">{props.subjects.map((subject) => <option key={subject.id} value={subject.slug}>{subject.name}</option>)}</Select></label>
            <label className="text-xs font-semibold text-slate-800">Topic (optional)<Select value={topic} onChange={(e) => setTopic(e.target.value)} containerClassName="mt-1.5"><option value="">Whole subject / not sure</option>{props.initialTopic && !selected?.topics.some((item) => item.name === props.initialTopic) ? <option value={props.initialTopic}>{props.initialTopic}</option> : null}{selected?.topics.map((item) => <option key={item.slug} value={item.name}>{item.name}</option>)}</Select></label>
            <label className="text-xs font-semibold text-slate-800">Class type<Select value={classType} onChange={(e) => setClassType(e.target.value as ClassType)} containerClassName="mt-1.5">{CLASS_TYPES.map((type) => <option key={type} value={type}>{CLASS_TYPE_LABELS[type]}</option>)}</Select></label>
          </div>
          <p className="text-[11.5px] leading-5 text-slate-500">Not sure which class suits you? Choose <strong className="font-semibold text-slate-700">Not Sure / Help Me Choose</strong> and Academic Support will advise.</p>
          <Button type="button" fullWidth size="lg" onClick={() => setStep(2)} disabled={!selected}>Continue</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <div className="rounded-xl bg-slate-50 px-3.5 py-3 text-[11.5px] leading-5 text-slate-600">
            <strong className="font-semibold text-slate-950">{selected?.name}{topic ? ` · ${topic}` : ""}</strong> · {CLASS_TYPE_LABELS[classType]}
            <button type="button" onClick={() => setStep(1)} className="ml-2 rounded font-semibold text-brand-500 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">Change</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Student name" name="studentName" defaultValue={props.studentName} required />
            <Field label="Email (optional)" name="email" type="email" defaultValue={props.email} />
          </div>
          <div>
            <Field
              label="WhatsApp / phone number"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="e.g. 08012345678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              onBlur={() => setPhoneTouched(true)}
              aria-invalid={phoneTouched && !phoneValid}
              aria-describedby={phoneTouched && !phoneValid ? `${formId}-phone-error` : undefined}
              required
            />
            {phoneTouched && !phoneValid ? <p id={`${formId}-phone-error`} role="alert" className="mt-1.5 text-[11.5px] font-semibold text-danger-600">Enter a valid WhatsApp or phone number, like 08012345678.</p> : null}
            <label className="mt-2.5 flex min-h-11 cursor-pointer items-center gap-3 text-xs text-slate-700"><input type="checkbox" checked={callInstead} onChange={(event) => setCallInstead(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />I would rather have a phone call than WhatsApp</label>
          </div>
          <fieldset>
            <legend className="text-xs font-semibold text-slate-800">When are you usually free?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {SCHEDULE_OPTIONS.map((option) => (
                <label key={option} className={`flex min-h-11 cursor-pointer items-center rounded-xl border px-3.5 text-[12.5px] font-semibold transition ${schedule === option ? "border-brand-500 bg-brand-50 text-brand-600" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                  <input type="radio" name={`${formId}-schedule`} value={option} checked={schedule === option} onChange={() => setSchedule(option)} className="sr-only" />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs font-semibold text-slate-800">Anything else we should know? (optional)<textarea name="message" rows={3} maxLength={1500} placeholder="Exact times that suit you, what you are finding hard, anything useful." className={`${field} py-3`} /></label>
          <fieldset className="space-y-1">
            <legend className="text-[11px] leading-5 text-slate-500">Your request already lets us contact you about this enquiry. Optionally, we can also send study updates:</legend>
            <Consent name="promotionalWhatsappConsent">Useful updates by WhatsApp</Consent>
            <Consent name="promotionalEmailConsent">Useful updates by email</Consent>
          </fieldset>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="lg" iconOnly onClick={startOver} aria-label="Back to class details"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Button>
            <Button loading={submitting} loadingLabel="Sending request" disabled={!phoneValid} fullWidth size="lg">Send Class Request</Button>
          </div>
          <p className="text-center text-[11px] text-slate-500">Academic Support usually replies within a day.</p>
        </form>
      )}
    </Sheet>
  </>;
}

function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <label className="block text-xs font-semibold text-slate-800">{label}<input name={name} maxLength={300} className={field} {...props} /></label>; }
function Consent({ name, children }: { name: string; children: React.ReactNode }) { return <label className="flex min-h-11 cursor-pointer items-center gap-3 text-xs text-slate-700"><input type="checkbox" name={name} className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />{children}</label>; }
