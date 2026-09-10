"use client";

import Link from "next/link";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { buttonClasses } from "@/components/ui/variants";
import { CLASS_TYPES, CLASS_TYPE_LABELS, type ClassLeadSource, type RecommendationReason } from "@/features/classes/types";
import { studentClassMessage, whatsappUrl } from "@/features/classes/whatsapp";
import { track } from "@/features/analytics/events";
import type { ClassCatalogueSubject } from "@/features/classes/service";

interface Props {
  subjects: ClassCatalogueSubject[];
  studentName: string;
  email: string;
  initialOpen?: boolean;
  initialExamType: "jamb" | "waec";
  initialSubjectSlug?: string;
  initialTopic?: string;
  source?: ClassLeadSource;
  recommendationReason?: RecommendationReason;
  recentAccuracy?: number | null;
}

const field = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-950 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15";

export function ClassRequestFlow(props: Props) {
  const [open, setOpen] = useState(Boolean(props.initialOpen));
  const [subjectSlug, setSubjectSlug] = useState(props.initialSubjectSlug && props.subjects.some((s) => s.slug === props.initialSubjectSlug) ? props.initialSubjectSlug : props.subjects[0]?.slug ?? "");
  const [topic, setTopic] = useState(props.initialTopic ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState(false);
  const selected = useMemo(() => props.subjects.find((subject) => subject.slug === subjectSlug), [props.subjects, subjectSlug]);
  const whatsapp = whatsappUrl(studentClassMessage(selected?.name), process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER?.replace(/\D/g, "") || null);

  const close = () => { setOpen(false); setReceived(false); setError(null); };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || submitting) return;
    setSubmitting(true); setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/classes/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        studentName: data.get("studentName"), email: data.get("email"), phone: data.get("phone"),
        examType: data.get("examType"), subjectSlug: selected.slug, subjectName: selected.name,
        topic: data.get("topic"), classType: data.get("classType"), preferredContactMethod: data.get("preferredContactMethod"),
        preferredSchedule: data.get("preferredSchedule"), message: data.get("message"),
        source: props.source ?? "class_page", recommendationReason: props.recommendationReason ?? "student_requested",
        recentAccuracy: props.recentAccuracy ?? null,
        promotionalWhatsappConsent: data.get("promotionalWhatsappConsent") === "on",
        promotionalEmailConsent: data.get("promotionalEmailConsent") === "on",
      }) });
      const payload = await response.json() as { id?: string; error?: string; deduplicated?: boolean };
      if (!response.ok || !payload.id) throw new Error(payload.error || "Could not submit your request.");
      track("class_request_submitted", { source: props.source ?? "class_page", classType: String(data.get("classType")), subjectSlug: selected.slug, deduplicated: Boolean(payload.deduplicated) });
      setReceived(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit your request."); }
    finally { setSubmitting(false); }
  };

  return <>
    <Button type="button" size="lg" onClick={() => { setOpen(true); track("class_request_started", { source: props.source ?? "class_page", subjectSlug, reason: props.recommendationReason ?? "student_requested" }); }}>Request a Class</Button>
    <Sheet open={open} onClose={close} title={received ? "Request received" : "Request a Master Class"} description={received ? undefined : "Tell Academic Support how we can help. Known details are already filled in."} size="lg" dismissible={!submitting}>
      {received ? <div className="py-5 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-success-600" aria-hidden="true" /><h3 className="mt-4 font-serif text-2xl font-semibold text-slate-950">Your class request has been received.</h3><p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-slate-600">Our Academic Support team will contact you using your preferred contact method.</p><div className="mt-6 grid gap-2 sm:grid-cols-2"><Link href="/classes" onClick={close} className={buttonClasses({ variant: "secondary", size: "lg" })}>Back to Classes</Link>{whatsapp ? <a onClick={() => track("class_whatsapp_clicked", { subjectSlug: selected?.slug ?? null })} href={whatsapp} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "primary", size: "lg" })}><MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />Continue on WhatsApp</a> : null}</div></div> :
      <form onSubmit={submit} className="space-y-4">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Student name" name="studentName" defaultValue={props.studentName} required />
          <Field label="Email" name="email" type="email" defaultValue={props.email} />
          <Field label="WhatsApp / phone number" name="phone" type="tel" placeholder="e.g. 08012345678" required />
          <label className="text-xs font-semibold text-slate-800">Exam<input type="hidden" name="examType" value={props.initialExamType} /><span className="mt-1.5 flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700">{props.initialExamType.toUpperCase()}</span></label>
          <label className="text-xs font-semibold text-slate-800">Subject<Select name="subjectSlug" value={subjectSlug} onChange={(e) => { setSubjectSlug(e.target.value); setTopic(""); }} containerClassName="mt-1.5">{props.subjects.map((subject) => <option key={subject.id} value={subject.slug}>{subject.name}</option>)}</Select></label>
          <label className="text-xs font-semibold text-slate-800">Topic (optional)<Select name="topic" value={topic} onChange={(e) => setTopic(e.target.value)} containerClassName="mt-1.5"><option value="">Whole subject / not sure</option>{props.initialTopic && !selected?.topics.some((item) => item.name === props.initialTopic) ? <option value={props.initialTopic}>{props.initialTopic}</option> : null}{selected?.topics.map((item) => <option key={item.slug} value={item.name}>{item.name}</option>)}</Select></label>
          <label className="text-xs font-semibold text-slate-800">Class type<Select name="classType" defaultValue={props.initialTopic ? "topic_clinic" : "not_sure"} containerClassName="mt-1.5">{CLASS_TYPES.map((type) => <option key={type} value={type}>{CLASS_TYPE_LABELS[type]}</option>)}</Select></label>
          <label className="text-xs font-semibold text-slate-800">Preferred contact<Select name="preferredContactMethod" defaultValue="whatsapp" containerClassName="mt-1.5"><option value="whatsapp">WhatsApp</option><option value="phone">Phone call</option><option value="email">Email</option></Select></label>
        </div>
        <Field label="When are you usually available?" name="preferredSchedule" placeholder="e.g. Weekdays after 5 pm" required />
        <label className="block text-xs font-semibold text-slate-800">Anything else we should know? (optional)<textarea name="message" rows={3} maxLength={1500} className={`${field} py-3`} /></label>
        <fieldset className="space-y-2 rounded-xl bg-slate-50 p-3.5"><legend className="px-1 text-xs font-bold text-slate-950">Optional study updates</legend><p className="text-[11px] leading-5 text-slate-500">Your request itself allows us to contact you about this enquiry. These separate choices are for future offers and study-support updates.</p><Consent name="promotionalWhatsappConsent">Send useful updates by WhatsApp</Consent><Consent name="promotionalEmailConsent">Send useful updates by email</Consent></fieldset>
        <Button loading={submitting} loadingLabel="Sending request" fullWidth size="lg">Send Class Request</Button>
      </form>}
    </Sheet>
  </>;
}

function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) { return <label className="block text-xs font-semibold text-slate-800">{label}<input name={name} maxLength={300} className={field} {...props} /></label>; }
function Consent({ name, children }: { name: string; children: React.ReactNode }) { return <label className="flex min-h-11 cursor-pointer items-center gap-3 text-xs text-slate-700"><input type="checkbox" name={name} className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />{children}</label>; }
