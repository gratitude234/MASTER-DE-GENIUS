import { BookOpenCheck, CheckCircle2, UsersRound } from "lucide-react";
import { ClassRequestFlow } from "@/components/classes/class-request-flow";
import { Badge } from "@/components/ui/badge";
import { typography } from "@/components/ui/variants";
import { CLASS_TYPE_LABELS, CLASS_LEAD_SOURCES, STUDENT_STATUS_LABELS, type ClassLeadSource, type RecommendationReason } from "@/features/classes/types";
import { latestLeadPhone, listStudentLeads, loadClassCatalogue } from "@/features/classes/service";
import { recommendClass } from "@/features/classes/recommendation";
import { getStudentProfile } from "@/features/profile/queries";
import { loadHistory } from "@/features/results/service";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function ClassesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ user, profile, preference, examBody }, query] = await Promise.all([getStudentProfile(), searchParams]);
  const [history, subjects, requests, defaultPhone] = await Promise.all([loadHistory(user.id), loadClassCatalogue(examBody?.code), listStudentLeads(user.id), latestLeadPhone(user.id)]);
  const recommendation = recommendClass(history, preference?.exam_body_id);
  const source = CLASS_LEAD_SOURCES.includes(query.source as ClassLeadSource) ? query.source as ClassLeadSource : "class_page";
  const reasonSet = new Set<RecommendationReason>(["weak_topic", "weak_subject", "repeated_mistakes", "student_requested"]);
  const reason = reasonSet.has(query.recommendationReason as RecommendationReason) ? query.recommendationReason as RecommendationReason : recommendation?.reason ?? "student_requested";
  const initialSubjectSlug = query.subjectSlug ?? recommendation?.subjectSlug;
  const initialTopic = query.topic ?? recommendation?.topic ?? undefined;
  const accuracy = query.accuracy && /^\d{1,3}$/.test(query.accuracy) ? Math.min(100, Number(query.accuracy)) : recommendation?.accuracy ?? null;
  // A class request belongs to the student's configured workspace. Changing
  // exam bodies is an account preference action, not a hidden side effect of
  // an enquiry form.
  const examType = examBody?.code === "waec" ? "waec" : "jamb";

  return <div className="screen-enter space-y-5">
    <header className="rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-200">Master Classes</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Personal help when practice is not enough.</h1>
      <p className="mt-3 max-w-2xl text-[13px] leading-6 text-white/65">Learn directly from experienced tutors through focused support for JAMB and WAEC subjects.</p>
      <div className="mt-5"><ClassRequestFlow subjects={subjects} studentName={profile.full_name} email={user.email ?? ""} defaultPhone={defaultPhone} initialOpen={query.request === "1"} initialExamType={examType} initialSubjectSlug={initialSubjectSlug} initialTopic={initialTopic} source={source} recommendationReason={reason} recentAccuracy={accuracy} /></div>
    </header>

    {recommendation ? <section className="rounded-2xl border border-brand-200 bg-brand-50 p-5"><p className={cn(typography.eyebrow, "text-brand-500")}>Recommended for you</p><div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className={typography.h2}>{recommendation.subjectName}{recommendation.topic ? ` · ${recommendation.topic}` : ""}</h2>{recommendation.accuracy != null ? <p className="mono-number mt-1 text-xs font-semibold text-slate-600">Recent accuracy: {recommendation.accuracy}%</p> : null}<p className="mt-2 max-w-xl text-[12.5px] leading-5 text-slate-600">{recommendation.reason === "repeated_mistakes" ? "You have met this area more than once. A focused lesson may help the ideas click." : "A focused lesson may help you improve your understanding of this area."}</p></div><ClassRequestFlow subjects={subjects} studentName={profile.full_name} email={user.email ?? ""} defaultPhone={defaultPhone} initialExamType={recommendation.examType} initialSubjectSlug={recommendation.subjectSlug} initialTopic={recommendation.topic ?? undefined} source={recommendation.topic ? "topic_recommendation" : "subject_recommendation"} recommendationReason={recommendation.reason} recentAccuracy={recommendation.accuracy} /></div></section> : null}

    <section><h2 className={typography.h2}>Choose the support that fits</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
      [UsersRound, "Group Classes", "Learn with other students in a structured class."],
      [CheckCircle2, "Private 1-on-1", "Focused support built around your questions."],
      [BookOpenCheck, "Topic Clinics & Bootcamps", "Target one difficult topic or prepare intensively."],
    ].map(([Icon, title, copy]) => { const C = Icon as typeof UsersRound; return <article key={String(title)} className="rounded-2xl border border-slate-200 bg-white p-5"><C className="h-5 w-5 text-brand-500" aria-hidden="true" /><h3 className="mt-3 text-sm font-bold text-slate-950">{String(title)}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{String(copy)}</p></article>; })}</div></section>

    {requests.length ? <section><h2 className={typography.h2}>Your Requests</h2><div className="mt-3 space-y-2.5">{requests.map((request) => <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-[18px]"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-[13px] font-bold text-slate-950">{request.subject_name}{request.topic ? ` — ${request.topic}` : ""}</h3><p className="mt-1 text-[11.5px] text-slate-500">{CLASS_TYPE_LABELS[request.class_type]} · Submitted {date.format(new Date(request.created_at))}</p></div><Badge tone={request.status === "enrolled" ? "success" : request.status === "closed" || request.status === "not_interested" ? "neutral" : "brand"}>{STUDENT_STATUS_LABELS[request.status]}</Badge></div></article>)}</div></section> : null}
  </div>;
}
