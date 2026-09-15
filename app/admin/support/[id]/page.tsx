import { notFound } from "next/navigation";
import { AdminPageHeader, DefinitionGrid, Panel, TextLink } from "@/components/admin/admin-ui";
import { SupportStatusBadge } from "@/components/admin/status-badges";
import { SupportCaseWorkspace } from "@/components/admin/support-case-workspace";
import { auditActionLabel } from "@/features/admin/audit";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { displayName, loadAssignees, loadEntityHistory, loadInternalNotes } from "@/features/admin/directory";
import { formatDateTime, humanize } from "@/features/admin/format";
import { isUuid } from "@/features/admin/params";
import { SUPPORT_CATEGORY_LABELS, loadSupportCase } from "@/features/admin/support";

export const dynamic = "force-dynamic";

export default async function AdminSupportCasePage({ params }: { params: Promise<{ id: string }> }) {
  const [admin, { id }] = await Promise.all([requireAdminPermission("support.view"), params]);
  if (!isUuid(id)) notFound();
  const supportCase = await loadSupportCase(admin.userId, id);
  if (!supportCase) notFound();

  const [notes, history, assignees] = await Promise.all([
    loadInternalNotes(admin.userId, "support_case", id),
    loadEntityHistory(admin.userId, "support_case", id),
    loadAssignees(admin.userId, "support.manage"),
  ]);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={supportCase.subject}
        breadcrumbs={[{ href: "/admin/support", label: "Support" }]}
        description={`${SUPPORT_CATEGORY_LABELS[supportCase.category]} · via ${humanize(supportCase.channel)}`}
        actions={<SupportStatusBadge status={supportCase.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Case">
            <DefinitionGrid
              columns={3}
              items={[
                ["Student", supportCase.student ? (can(admin, "students.view") ? <TextLink key="student" href={`/admin/students/${supportCase.user_id}`}>{displayName(supportCase.student)}</TextLink> : displayName(supportCase.student)) : "Not linked to an account"],
                ["Email", supportCase.student?.email ?? "—"],
                ["Owner", supportCase.assigneeName ?? "Unassigned"],
                ["Opened", formatDateTime(supportCase.created_at)],
                ["Opened by", supportCase.createdByName ?? "—"],
                ["Resolved", formatDateTime(supportCase.resolved_at, "Not yet")],
              ]}
            />
            {supportCase.message ? <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[12.5px] leading-5 text-slate-800">{supportCase.message}</p> : null}
          </Panel>

          <Panel title="Internal notes" description="Visible to admins only.">
            {notes.length ? (
              <ol className="space-y-3">
                {notes.map((note) => (
                  <li key={note.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="whitespace-pre-wrap text-[12.5px] text-slate-800">{note.body}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{note.author} · {formatDateTime(note.createdAt)}</p>
                  </li>
                ))}
              </ol>
            ) : <p className="text-[13px] text-slate-600">No notes yet.</p>}
          </Panel>

          <Panel title="History">
            <ol className="space-y-2">
              {history.map((entry) => (
                <li key={entry.id} className="text-[12.5px] text-slate-700">
                  <span className="font-semibold text-slate-950">
                    {entry.action === "support_case.status_change" ? `Status: ${humanize(String(entry.before?.status ?? ""))} → ${humanize(String(entry.after?.status ?? ""))}` : auditActionLabel(entry.action)}
                  </span> · {entry.actor} · {formatDateTime(entry.createdAt)}
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        {can(admin, "support.manage") ? (
          <Panel title="Work this case">
            <SupportCaseWorkspace
              caseId={id}
              status={supportCase.status}
              assignedTo={supportCase.assigned_to}
              assignees={assignees.map((entry) => ({ userId: entry.userId, label: entry.userId === admin.userId ? `${displayName(entry)} (me)` : displayName(entry) }))}
            />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
