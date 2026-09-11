import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { AdminLeadActions } from "@/components/classes/admin-lead-actions";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { buttonClasses, typography } from "@/components/ui/variants";
import { ADMIN_STATUS_LABELS, CLASS_LEAD_STATUSES, CLASS_TYPE_LABELS } from "@/features/classes/types";
import { countLeadsByStatus, listAdminLeads, loadClassCatalogue } from "@/features/classes/service";
import { adminClassMessage, leadReference, whatsappUrl } from "@/features/classes/whatsapp";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export default async function AdminClassesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { page: requestedPage, ...filters } = await searchParams;
  const [{ leads, total, page, pageCount }, totals, subjects] = await Promise.all([
    listAdminLeads(filters, Number.parseInt(requestedPage ?? "1", 10) || 1),
    countLeadsByStatus(),
    loadClassCatalogue(),
  ]);
  const filterQuery = (next: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as Record<string, string>, page: String(next) }).toString();
  const number = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;
  return <div className="screen-enter space-y-5"><header><p className={cn(typography.eyebrow, "text-brand-500")}>Academic Support</p><h1 className={cn("mt-1", typography.h1)}>Premium Classes CRM</h1><p className="mt-1 text-xs text-slate-600">Follow every request from first contact through enrolment.</p></header>
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{CLASS_LEAD_STATUSES.map((status) => <div key={status} className="flex flex-col-reverse rounded-xl border border-slate-200 bg-white p-3"><dt className="mt-1 text-[10px] font-semibold text-slate-500">{ADMIN_STATUS_LABELS[status]}</dt><dd className="mono-number text-xl font-semibold text-slate-950">{totals[status]}</dd></div>)}</dl>
    <form className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6"><label className="text-xs font-semibold">Status<Select name="status" defaultValue={filters.status ?? ""} containerClassName="mt-1"><option value="">All</option>{CLASS_LEAD_STATUSES.map((value) => <option key={value} value={value}>{ADMIN_STATUS_LABELS[value]}</option>)}</Select></label><label className="text-xs font-semibold">Exam<Select name="exam" defaultValue={filters.exam ?? ""} containerClassName="mt-1"><option value="">All</option><option value="jamb">JAMB</option><option value="waec">WAEC</option></Select></label><label className="text-xs font-semibold">Subject<Select name="subject" defaultValue={filters.subject ?? ""} containerClassName="mt-1"><option value="">All</option>{subjects.map((subject) => <option key={subject.id} value={subject.slug}>{subject.name}</option>)}</Select></label><label className="text-xs font-semibold">Class type<Select name="classType" defaultValue={filters.classType ?? ""} containerClassName="mt-1"><option value="">All</option>{Object.entries(CLASS_TYPE_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select></label><label className="text-xs font-semibold">From<input type="date" name="from" defaultValue={filters.from ?? ""} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-xs" /></label><label className="text-xs font-semibold">Search<input name="search" defaultValue={filters.search ?? ""} placeholder="Name, email, phone" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-xs" /></label><button className={buttonClasses({ variant: "dark", size: "md", className: "sm:col-span-3 lg:col-span-6" })}>Apply filters</button></form>
    <p className="text-xs font-bold text-slate-700">{total === leads.length ? `${total} lead${total === 1 ? "" : "s"}` : `Showing ${leads.length} of ${total} leads`}</p>
    <div className="space-y-3">{leads.map((lead) => { const wa = whatsappUrl(adminClassMessage({ studentName: lead.student_name, examType: lead.exam_type, subjectName: lead.subject_name }), lead.phone.replace(/\D/g, "") || number); return <article key={lead.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold text-slate-950">{lead.student_name}</h2><p className="mt-1 text-xs text-slate-600">{lead.exam_type.toUpperCase()} · {lead.subject_name}{lead.topic ? ` · ${lead.topic}` : ""} · {CLASS_TYPE_LABELS[lead.class_type]}</p><p className="mt-1 text-[11px] text-slate-500">{date.format(new Date(lead.created_at))} · Source: {lead.source.replaceAll("_", " ")} · Ref <span className="mono-number font-semibold text-slate-700">{leadReference(lead.id)}</span></p></div><Badge tone={lead.status === "enrolled" ? "success" : lead.status === "new" ? "warning" : "brand"}>{ADMIN_STATUS_LABELS[lead.status]}</Badge></div><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3"><div><dt className="font-bold text-slate-500">Contact</dt><dd className="mt-1 text-slate-950">{lead.phone}<br/>{lead.email || "No email"} · prefers {lead.preferred_contact_method}</dd></div><div><dt className="font-bold text-slate-500">Availability</dt><dd className="mt-1 text-slate-950">{lead.preferred_schedule}</dd></div><div><dt className="font-bold text-slate-500">Recommendation</dt><dd className="mt-1 text-slate-950">{lead.recommendation_reason.replaceAll("_", " ")}{lead.recent_accuracy != null ? ` · ${lead.recent_accuracy}% recent accuracy` : ""}</dd></div></dl>{lead.message ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-700">{lead.message}</p> : null}{wa ? <a href={wa} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-4" })}>Message on WhatsApp <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></a> : null}<div className="mt-4"><AdminLeadActions id={lead.id} initialStatus={lead.status} initialNotes={lead.admin_notes} /></div></article>; })}</div>
    {pageCount > 1 ? <nav className="flex items-center justify-between gap-3" aria-label="Lead pages">
      {page > 1 ? <Link href={`/admin/classes?${filterQuery(page - 1)}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>Previous</Link> : <span />}
      <p className="text-xs font-semibold text-slate-600">Page {page} of {pageCount}</p>
      {page < pageCount ? <Link href={`/admin/classes?${filterQuery(page + 1)}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>Next</Link> : <span />}
    </nav> : null}
  </div>;
}
