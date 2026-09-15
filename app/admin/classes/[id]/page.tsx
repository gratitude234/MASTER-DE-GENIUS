import { notFound } from "next/navigation";
import { AdminPageHeader, DefinitionGrid, Panel, TextLink } from "@/components/admin/admin-ui";
import { LeadStatusBadge } from "@/components/admin/status-badges";
import { LeadWorkspace } from "@/components/admin/lead-workspace";
import { auditActionLabel } from "@/features/admin/audit";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { displayName, loadAssignees, loadEntityHistory, loadInternalNotes } from "@/features/admin/directory";
import { formatDateTime, formatPercent, humanize } from "@/features/admin/format";
import { isUuid } from "@/features/admin/params";
import { loadAdminLead } from "@/features/classes/service";
import { ADMIN_STATUS_LABELS, CLASS_TYPE_LABELS, type ClassLeadStatus } from "@/features/classes/types";
import { adminClassMessage, leadReference, whatsappUrl } from "@/features/classes/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function describeHistory(entry: { action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }, owners: Map<string, string>) {
  if (entry.action === "class_lead.status_change") {
    const from = ADMIN_STATUS_LABELS[entry.before?.status as ClassLeadStatus] ?? String(entry.before?.status ?? "");
    const to = ADMIN_STATUS_LABELS[entry.after?.status as ClassLeadStatus] ?? String(entry.after?.status ?? "");
    return `Status: ${from} → ${to}`;
  }
  if (entry.action === "class_lead.assign") {
    const to = entry.after?.assigned_to;
    return typeof to === "string" ? `Assigned to ${owners.get(to) ?? "an admin"}` : "Unassigned";
  }
  return auditActionLabel(entry.action);
}

export default async function AdminLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const [admin, { id }] = await Promise.all([requireAdminPermission("classes.view"), params]);
  if (!isUuid(id)) notFound();
  const lead = await loadAdminLead(id);
  if (!lead) notFound();

  const [notes, history, assignees, consents] = await Promise.all([
    loadInternalNotes(admin.userId, "class_lead", id),
    loadEntityHistory(admin.userId, "class_lead", id),
    loadAssignees(admin.userId, "classes.manage"),
    createAdminClient().from("marketing_consents").select("channel, granted_at, revoked_at").eq("user_id", lead.user_id),
  ]);
  const owners = new Map(assignees.map((entry) => [entry.userId, displayName(entry)]));
  const whatsappHref = whatsappUrl(adminClassMessage({ studentName: lead.student_name, examType: lead.exam_type, subjectName: lead.subject_name }), lead.phone);
  const activeConsents = (consents.data ?? []).filter((consent) => !consent.revoked_at).map((consent) => consent.channel);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={lead.student_name}
        breadcrumbs={[{ href: "/admin/classes", label: "Master Classes" }]}
        description={`${lead.exam_type.toUpperCase()} · ${lead.subject_name}${lead.topic ? ` · ${lead.topic}` : ""} · Ref ${leadReference(lead.id)}`}
        actions={<LeadStatusBadge status={lead.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Request">
            <DefinitionGrid
              columns={3}
              items={[
                ["Class type", CLASS_TYPE_LABELS[lead.class_type]],
                ["Exam", lead.exam_type.toUpperCase()],
                ["Subject", lead.subject_name],
                ["Topic", lead.topic ?? "Any topic"],
                ["Availability", lead.preferred_schedule],
                ["Created", formatDateTime(lead.created_at)],
              ]}
            />
            {lead.message ? (
              <div className="mt-4">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500">Student message</p>
                <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[12.5px] leading-5 text-slate-800">{lead.message}</p>
              </div>
            ) : null}
          </Panel>

          <Panel title="Why they asked" description="Context captured when the request was made.">
            <DefinitionGrid
              columns={3}
              items={[
                ["Source", humanize(lead.source)],
                ["Recommendation", humanize(lead.recommendation_reason)],
                ["Recent accuracy", formatPercent(lead.recent_accuracy, "Not recorded")],
              ]}
            />
            {can(admin, "students.view") ? <p className="mt-3 text-[12px]"><TextLink href={`/admin/students/${lead.user_id}`}>Open the student&apos;s full profile</TextLink></p> : null}
          </Panel>

          <Panel title="Internal notes" description="Visible to admins only. Never shown to the student.">
            {lead.admin_notes ? (
              <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500">Earlier note</p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-slate-800">{lead.admin_notes}</p>
              </div>
            ) : null}
            {notes.length ? (
              <ol className="space-y-3">
                {notes.map((note) => (
                  <li key={note.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="whitespace-pre-wrap text-[12.5px] text-slate-800">{note.body}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{note.author} · {formatDateTime(note.createdAt)}</p>
                  </li>
                ))}
              </ol>
            ) : !lead.admin_notes ? <p className="text-[13px] text-slate-600">No notes yet.</p> : null}
          </Panel>

          <Panel title="History">
            {history.length ? (
              <ol className="space-y-2">
                {history.map((entry) => (
                  <li key={entry.id} className="text-[12.5px] text-slate-700">
                    <span className="font-semibold text-slate-950">{describeHistory(entry, owners)}</span> · {entry.actor} · {formatDateTime(entry.createdAt)}
                  </li>
                ))}
                <li className="text-[12.5px] text-slate-500">Request submitted · {formatDateTime(lead.created_at)}</li>
              </ol>
            ) : <p className="text-[13px] text-slate-600">Request submitted {formatDateTime(lead.created_at)}. No changes since.</p>}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Contact">
            <DefinitionGrid
              columns={2}
              items={[
                ["Phone", <span key="phone" className="mono-number">{lead.phone}</span>],
                ["Email", lead.email ?? "Not given"],
                ["Prefers", humanize(lead.preferred_contact_method)],
                ["Owner", lead.assigned_to ? owners.get(lead.assigned_to) ?? "Former admin" : "Unassigned"],
                ["First contacted", formatDateTime(lead.contacted_at, "Not yet")],
                ["Promotional consent", activeConsents.length ? activeConsents.map((channel) => humanize(channel)).join(", ") : "None"],
              ]}
            />
            <p className="mt-3 text-[11px] leading-4 text-slate-500">Submitting a request permits contact about that request only. Promotional messages need the consent listed above.</p>
          </Panel>
          <Panel title="Work this lead">
            <LeadWorkspace
              leadId={lead.id}
              status={lead.status}
              assignedTo={lead.assigned_to}
              currentAdminId={admin.userId}
              canManage={can(admin, "classes.manage")}
              assignees={assignees.map((entry) => ({ userId: entry.userId, label: entry.userId === admin.userId ? `${displayName(entry)} (me)` : displayName(entry) }))}
              whatsappHref={whatsappHref}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
