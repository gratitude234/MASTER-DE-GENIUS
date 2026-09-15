import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionDialog } from "@/components/admin/action-dialog";
import { AdminPageHeader, DataTable, DefinitionGrid, EmptyRow, Panel, Stat, StatGrid, TextLink, cell } from "@/components/admin/admin-ui";
import { GrantMasterDialog } from "@/components/admin/grant-master-dialog";
import { LeadStatusBadge, PaymentStatusBadge, PlanBadge, SessionStatusBadge, SupportStatusBadge } from "@/components/admin/status-badges";
import { SupportCaseDialog } from "@/components/admin/support-case-dialog";
import { Badge } from "@/components/ui/badge";
import { InlineAlert } from "@/components/ui/inline-alert";
import { reactivateStudentAction, suspendStudentAction } from "@/features/admin/actions/students";
import { auditActionLabel } from "@/features/admin/audit";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { displayName, loadAssignees, loadEntityHistory } from "@/features/admin/directory";
import { formatCount, formatDate, formatDateTime, formatKobo, formatPercent, formatRelative, humanize } from "@/features/admin/format";
import { isUuid } from "@/features/admin/params";
import { listSessions } from "@/features/admin/sessions";
import { loadStudentDetail } from "@/features/admin/students";
import { SUPPORT_CATEGORY_LABELS, type SupportCategory } from "@/features/admin/support";
import { findPlan } from "@/features/billing/plans";
import { CLASS_TYPE_LABELS } from "@/features/classes/types";

export const dynamic = "force-dynamic";

export default async function AdminStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const [admin, { id }] = await Promise.all([requireAdminPermission("students.view"), params]);
  if (!isUuid(id)) notFound();

  const detail = await loadStudentDetail(admin, id);
  if (!detail) notFound();

  const [sessions, history, supportAssignees] = await Promise.all([
    can(admin, "sessions.view") ? listSessions(admin.userId, { userId: id }, 1) : Promise.resolve(null),
    can(admin, "audit.view") ? loadEntityHistory(admin.userId, "student", id, 20) : Promise.resolve(null),
    can(admin, "support.manage") ? loadAssignees(admin.userId, "support.manage") : Promise.resolve(null),
  ]);

  const { identity, preparation, entitlement, academics } = detail;
  const name = identity.fullName.trim() || identity.email || "Unnamed student";
  const latestEvent = detail.entitlementEvents[0];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={name}
        breadcrumbs={[{ href: "/admin/students", label: "Students" }]}
        description={identity.email ?? undefined}
        actions={
          <>
            {can(admin, "support.manage") && supportAssignees ? (
              <SupportCaseDialog userId={id} studentLabel={name} assignees={supportAssignees.map((entry) => ({ userId: entry.userId, label: displayName(entry) }))} />
            ) : null}
            {can(admin, "entitlements.grant") ? (
              <GrantMasterDialog userId={id} studentName={name} currentExpiry={entitlement.expiresAt} isMaster={entitlement.isMaster} />
            ) : null}
            {can(admin, "students.manage") ? (
              detail.suspension ? (
                <ActionDialog
                  triggerLabel="Reactivate account"
                  title="Reactivate this account?"
                  description="The student will be able to sign in and use Master De Genius again."
                  confirmLabel="Reactivate"
                  reasonLabel="Reason for reactivation"
                  action={reactivateStudentAction.bind(null, id)}
                />
              ) : (
                <ActionDialog
                  triggerLabel="Suspend account"
                  triggerVariant="secondary"
                  title="Suspend this account?"
                  description="The student is signed out of every page immediately and cannot sign in again until reactivated. Their results, payments and history are kept."
                  confirmLabel="Suspend account"
                  confirmVariant="danger"
                  reasonLabel="Reason for suspension"
                  action={suspendStudentAction.bind(null, id)}
                />
              )
            ) : null}
          </>
        }
      />

      {detail.suspension ? (
        <InlineAlert tone="danger">
          Suspended {formatDateTime(detail.suspension.suspendedAt)} by {detail.suspension.suspendedBy}: {detail.suspension.reason}
        </InlineAlert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="All exam preparations">
            {detail.preparations.map(item => <section key={item.examName} className="mb-4 rounded-lg border p-3">
              <h3 className="font-bold">{item.examName} {item.examYear}{item.isDefault ? " · Default" : ""}</h3>
              <p className="mt-1 text-sm">Target: {item.target ?? "—"} · {item.subjects.join(", ")}</p>
              <p className="mt-2 text-sm">{item.academics ? `${item.academics.questions} questions · Accuracy: ${item.academics.accuracy ?? "—"}% · ${item.academics.activeMistakes} active mistakes` : "No academic summary available"}</p>
            </section>)}
          </Panel>
          <Panel title="Account and default preparation">
            <DefinitionGrid
              columns={3}
              items={[
                ["Account ID", <span key="id" className="mono-number break-all text-[11.5px]">{identity.id}</span>],
                ["Phone", identity.phone ?? detail.leads?.[0]?.phone ?? "Not recorded"],
                ["Joined", formatDate(identity.joinedAt)],
                ["Last sign-in", formatDateTime(identity.lastSignInAt, "Never")],
                ["Onboarding", identity.onboardingCompleted ? "Complete" : <Badge key="onboarding" tone="warning">Incomplete</Badge>],
                ["Exam", preparation ? `${preparation.examName} ${preparation.examYear}` : "Not set"],
                ["Target", preparation?.targetScore != null ? (preparation.examCode === "waec" ? `${preparation.targetScore}%` : String(preparation.targetScore)) : "—"],
                ["Study intensity", humanize(preparation?.studyIntensity)],
                ["Intended course", preparation?.intendedCourse ?? "—"],
              ]}
            />
            {preparation?.subjects.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {preparation.subjects.map((subject) => <Badge key={subject} tone="neutral">{subject}</Badge>)}
              </div>
            ) : null}
          </Panel>

          <Panel title="Default exam academic snapshot" description="From the same graded results the student sees on their Progress page. Revision sets are included here, as they are there.">
            {academics ? (
              academics.practiceCount + academics.mockCount === 0 ? (
                <p className="text-[13px] text-slate-600">No completed practice or mock yet.</p>
              ) : (
                <div className="space-y-4">
                  <StatGrid>
                    <Stat label="Practice completed" value={formatCount(academics.practiceCount)} />
                    <Stat label="Mocks submitted" value={formatCount(academics.mockCount)} />
                    <Stat label="Overall accuracy" value={formatPercent(academics.accuracy)} hint={`${formatCount(academics.questions)} questions`} />
                    <Stat label="Recent accuracy" value={formatPercent(academics.recentAccuracy)} hint={`Last 5 results · ${formatRelative(academics.lastCompletedAt)}`} />
                  </StatGrid>
                  <DefinitionGrid
                    items={[
                      ["Mistake Bank", `${formatCount(academics.activeMistakes)} active · ${formatCount(academics.masteredMistakes)} mastered`],
                      ["Class recommendation", academics.recommendation ? `${academics.recommendation.subjectName}${academics.recommendation.topic ? ` · ${academics.recommendation.topic}` : ""} (${humanize(academics.recommendation.reason)})` : "None yet"],
                    ]}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-[12px] font-bold text-slate-900">Subjects, weakest first</h3>
                      <DataTable label="Subject accuracy" minWidth={280}>
                        <thead><tr><th scope="col" className={cell.th}>Subject</th><th scope="col" className={`${cell.th} text-right`}>Questions</th><th scope="col" className={`${cell.th} text-right`}>Accuracy</th></tr></thead>
                        <tbody>
                          {academics.subjects.slice(0, 8).map((subject) => (
                            <tr key={subject.slug}><td className={cell.td}>{subject.name}</td><td className={`${cell.td} ${cell.num}`}>{formatCount(subject.total)}</td><td className={`${cell.td} ${cell.num}`}>{subject.accuracy}%</td></tr>
                          ))}
                        </tbody>
                      </DataTable>
                    </div>
                    <div>
                      <h3 className="mb-2 text-[12px] font-bold text-slate-900">Weak topics</h3>
                      <DataTable label="Weak topics" minWidth={280}>
                        <thead><tr><th scope="col" className={cell.th}>Topic</th><th scope="col" className={`${cell.th} text-right`}>Correct</th><th scope="col" className={`${cell.th} text-right`}>Accuracy</th></tr></thead>
                        <tbody>
                          {academics.weakTopics.length ? academics.weakTopics.map((topic) => (
                            <tr key={`${topic.subjectName}-${topic.topicName}`}>
                              <td className={cell.td}>{topic.topicName}<div className="text-[11px] text-slate-500">{topic.subjectName}</div></td>
                              <td className={`${cell.td} ${cell.num}`}>{topic.correct}/{topic.total}</td>
                              <td className={`${cell.td} ${cell.num}`}>{topic.accuracy}%</td>
                            </tr>
                          )) : <EmptyRow colSpan={3}>No categorised topic below 70% with at least 3 questions.</EmptyRow>}
                        </tbody>
                      </DataTable>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <InlineAlert tone="warning">{detail.academicsError}</InlineAlert>
            )}
          </Panel>

          {sessions ? (
            <Panel title="Recent sessions" action={<TextLink href={`/admin/exams?userId=${id}`}>All sessions</TextLink>} bodyClassName="p-0">
              <DataTable label="Recent sessions" minWidth={640}>
                <thead><tr><th scope="col" className={cell.th}>Session</th><th scope="col" className={cell.th}>Subjects</th><th scope="col" className={cell.th}>Status</th><th scope="col" className={`${cell.th} text-right`}>Answered</th><th scope="col" className={cell.th}>Started</th></tr></thead>
                <tbody>
                  {sessions.rows.length ? sessions.rows.slice(0, 10).map((row) => (
                    <tr key={row.session_id}>
                      <td className={cell.td}><TextLink href={`/admin/exams/${row.session_kind}/${row.session_id}`}>{humanize(row.session_type)}</TextLink></td>
                      <td className={`${cell.td} text-[11.5px]`}>{row.subject_names ?? "—"}</td>
                      <td className={cell.td}><SessionStatusBadge status={row.status} overdue={row.status === "in_progress" && Boolean(row.expires_at) && Date.parse(row.expires_at!) <= Date.now()} /></td>
                      <td className={`${cell.td} ${cell.num}`}>{row.answered_count}/{row.question_count}</td>
                      <td className={`${cell.td} whitespace-nowrap`}>{formatDateTime(row.started_at)}</td>
                    </tr>
                  )) : <EmptyRow colSpan={5}>No sessions started.</EmptyRow>}
                </tbody>
              </DataTable>
            </Panel>
          ) : null}

          {history ? (
            <Panel title="Admin history" description="Actions taken on this account, from the audit log.">
              {history.length ? (
                <ol className="space-y-2.5">
                  {history.map((entry) => (
                    <li key={entry.id} className="text-[12.5px] text-slate-700">
                      <span className="font-semibold text-slate-950">{auditActionLabel(entry.action)}</span> · {entry.actor} · {formatDateTime(entry.createdAt)}
                      {entry.reason ? <div className="text-[11.5px] text-slate-500">{entry.reason}</div> : null}
                    </li>
                  ))}
                </ol>
              ) : <p className="text-[13px] text-slate-600">No admin actions on this account.</p>}
            </Panel>
          ) : null}
        </div>

        <div className="space-y-5">
          <Panel title="Plan">
            <div className="flex items-center gap-2"><PlanBadge tier={entitlement.tier} />{entitlement.plan ? <span className="text-[12.5px] text-slate-700">{entitlement.plan.name}</span> : null}</div>
            <div className="mt-3">
              <DefinitionGrid
                items={[
                  [entitlement.isMaster ? "Master until" : "Last expiry", formatDateTime(entitlement.expiresAt, "Never had Master")],
                  ["First activated", formatDate(detail.entitlementActivatedAt, "—")],
                  ["Latest change", latestEvent ? `${latestEvent.source === "admin" ? "Manual grant" : "Payment"} · ${formatDate(latestEvent.createdAt)}` : "—"],
                ]}
              />
            </div>
            {detail.entitlementEvents.length ? (
              <ol className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                {detail.entitlementEvents.slice(0, 6).map((event) => (
                  <li key={event.id} className="text-[11.5px] text-slate-600">
                    <span className="font-semibold text-slate-900">{humanize(event.eventType)}</span> to {formatDate(event.newExpiresAt)} ·{" "}
                    {event.source === "admin" ? `manual by ${event.actor ?? "admin"}` : event.planName ?? "payment"}
                    {event.reason ? <div className="text-slate-500">“{event.reason}”</div> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </Panel>

          {detail.payments ? (
            <Panel title="Payments" action={<TextLink href={`/admin/payments?search=${encodeURIComponent(identity.email ?? id)}`}>Ledger</TextLink>}>
              {detail.payments.length ? (
                <ul className="divide-y divide-slate-100">
                  {detail.payments.slice(0, 8).map((payment) => (
                    <li key={payment.id} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold text-slate-900">{findPlan(payment.plan_slug)?.name ?? payment.plan_slug} · {formatKobo(payment.amount_kobo)}</p>
                        <p className="truncate text-[11px] text-slate-500"><span className="mono-number">{payment.reference}</span> · {formatDate(payment.paid_at ?? payment.created_at)}{payment.environment === "test" ? " · test" : ""}</p>
                      </div>
                      <PaymentStatusBadge status={payment.status} />
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-slate-600">No checkouts.</p>}
            </Panel>
          ) : null}

          {detail.leads ? (
            <Panel title="Premium Class requests">
              {detail.leads.length ? (
                <ul className="divide-y divide-slate-100">
                  {detail.leads.map((lead) => (
                    <li key={lead.id} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link href={`/admin/classes/${lead.id}`} className="text-[12.5px] font-semibold text-slate-900 hover:underline">{lead.subject_name}{lead.topic ? ` · ${lead.topic}` : ""}</Link>
                        <p className="text-[11px] text-slate-500">{CLASS_TYPE_LABELS[lead.class_type]} · {formatDate(lead.created_at)}</p>
                      </div>
                      <LeadStatusBadge status={lead.status} />
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-slate-600">No class requests.</p>}
            </Panel>
          ) : null}

          {detail.supportCases ? (
            <Panel title="Support cases">
              {detail.supportCases.length ? (
                <ul className="divide-y divide-slate-100">
                  {detail.supportCases.map((supportCase) => (
                    <li key={supportCase.id} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link href={`/admin/support/${supportCase.id}`} className="text-[12.5px] font-semibold text-slate-900 hover:underline">{supportCase.subject}</Link>
                        <p className="text-[11px] text-slate-500">{SUPPORT_CATEGORY_LABELS[supportCase.category as SupportCategory]} · {formatDate(supportCase.created_at)}</p>
                      </div>
                      <SupportStatusBadge status={supportCase.status} />
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-slate-600">No support cases.</p>}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
