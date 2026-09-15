import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionDialog } from "@/components/admin/action-dialog";
import { AdminPageHeader, DataTable, DefinitionGrid, Panel, Stat, StatGrid, cell } from "@/components/admin/admin-ui";
import { SessionStatusBadge } from "@/components/admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { InlineAlert } from "@/components/ui/inline-alert";
import { blockQuestionAction, finalizeOverdueSessionAction } from "@/features/admin/actions/operations";
import { auditActionLabel } from "@/features/admin/audit";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { loadEntityHistory } from "@/features/admin/directory";
import { accuracy, formatCount, formatDateTime, formatPercent, humanize } from "@/features/admin/format";
import { isUuid } from "@/features/admin/params";
import { loadSessionDetail } from "@/features/admin/sessions";

export const dynamic = "force-dynamic";

const OUTCOME_TONES = { correct: "success", incorrect: "danger", unanswered: "neutral" } as const;

export default async function AdminSessionPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const [admin, { kind, id }] = await Promise.all([requireAdminPermission("sessions.view"), params]);
  if ((kind !== "practice" && kind !== "exam") || !isUuid(id)) notFound();

  const [session, history] = await Promise.all([
    loadSessionDetail(admin.userId, kind, id),
    loadEntityHistory(admin.userId, kind === "exam" ? "exam_attempt" : "practice_session", id, 10),
  ]);
  if (!session) notFound();

  const finished = session.status === "completed" || session.status === "submitted";
  const showKeys = can(admin, "questions.view");
  const blockable = can(admin, "questions.manage");

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={`${humanize(session.sessionType)} · ${session.examName}`}
        breadcrumbs={[{ href: "/admin/exams", label: "Exams & Sessions" }]}
        description={`${session.subjects.map((subject) => subject.name).join(", ")} · ${session.student}`}
        actions={<SessionStatusBadge status={session.status} overdue={session.isOverdue} />}
      />

      {session.isOverdue ? (
        <InlineAlert tone="warning">
          This session&apos;s time ran out at {formatDateTime(session.expiresAt)} but it was never submitted. It submits automatically when the student next opens the app; you can also finalise it now with the answers the server already holds.
        </InlineAlert>
      ) : null}

      <StatGrid>
        <Stat label="Answered" value={`${formatCount(session.answeredCount)}/${formatCount(session.questionCount)}`} />
        <Stat label="Correct" value={finished ? formatCount(session.correctCount) : "Hidden until finished"} hint={finished ? `${formatPercent(accuracy(session.correctCount, session.questionCount))} of all questions` : undefined} />
        <Stat label="Flagged" value={session.flaggedCount == null ? "—" : formatCount(session.flaggedCount)} />
        <Stat label="Sync receipts" value={formatCount(session.sync.questionsWithReceipts)} hint={`Highest revision ${session.sync.highestRevision}`} />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Session">
          <DefinitionGrid
            columns={3}
            items={[
              ["Session ID", <span key="id" className="mono-number break-all text-[11.5px]">{session.id}</span>],
              ["Student", <Link key="student" href={can(admin, "students.view") ? `/admin/students/${session.userId}` : "#"} className="font-semibold hover:underline">{session.student}</Link>],
              ["Email", session.studentEmail ?? "—"],
              ["Question source", session.sourceProvider],
              ["Created", formatDateTime(session.createdAt)],
              ["Started", formatDateTime(session.startedAt)],
              ["Time limit", session.durationSeconds ? `${Math.round(session.durationSeconds / 60)} minutes` : "Untimed"],
              ["Expires", formatDateTime(session.expiresAt, "No expiry")],
              ["Finished", formatDateTime(session.finishedAt, "Not yet")],
              ["Submission", session.submissionReason ? humanize(session.submissionReason) : "—"],
              ["Last server write", formatDateTime(session.updatedAt)],
            ]}
          />
          {session.subjects.length > 1 ? (
            <div className="mt-4">
              <DataTable label="Subjects in this mock" minWidth={420}>
                <thead><tr><th scope="col" className={cell.th}>Subject</th><th scope="col" className={`${cell.th} text-right`}>Answered</th><th scope="col" className={`${cell.th} text-right`}>Correct</th></tr></thead>
                <tbody>
                  {session.subjects.map((subject) => (
                    <tr key={subject.name}><td className={cell.td}>{subject.name}</td><td className={`${cell.td} ${cell.num}`}>{subject.answeredCount}/{subject.questionCount}</td><td className={`${cell.td} ${cell.num}`}>{finished ? subject.correctCount : "—"}</td></tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          ) : null}
        </Panel>

        <div className="space-y-5">
          {session.isOverdue && can(admin, "sessions.recover") ? (
            <Panel title="Recovery">
              <p className="mb-3 text-[12.5px] text-slate-600">Finalising uses the engine&apos;s own submission. No answer can be added or changed, and the result is marked as time expired.</p>
              <ActionDialog
                triggerLabel="Finalise overdue session"
                triggerVariant="dark"
                title="Finalise this session?"
                description="It is graded with the answers the server received before time ran out."
                confirmLabel="Finalise"
                reasonLabel="Why is this needed?"
                action={finalizeOverdueSessionAction.bind(null, session.kind, session.id)}
              />
            </Panel>
          ) : null}
          <Panel title="Offline sync">
            <p className="text-[12.5px] text-slate-600">
              {session.sync.questionsWithReceipts
                ? `${formatCount(session.sync.questionsWithReceipts)} questions reached the server through the revision-safe sync, highest revision ${session.sync.highestRevision}.`
                : "No sync receipts. Answers saved before offline sync existed, or none were saved."}
            </p>
            <p className="mt-2 text-[11.5px] text-slate-500">Answers still waiting on a student&apos;s device are invisible to the server until they sync.</p>
          </Panel>
          {history.length ? (
            <Panel title="Admin history">
              <ol className="space-y-2">
                {history.map((entry) => (
                  <li key={entry.id} className="text-[12px] text-slate-700"><span className="font-semibold">{auditActionLabel(entry.action)}</span> · {entry.actor} · {formatDateTime(entry.createdAt)}{entry.reason ? <div className="text-slate-500">{entry.reason}</div> : null}</li>
                ))}
              </ol>
            </Panel>
          ) : null}
        </div>
      </div>

      <Panel title="Questions" description="As frozen when the session was created." bodyClassName="p-0">
        <DataTable label="Session questions" minWidth={980}>
          <thead>
            <tr>
              <th scope="col" className={cell.th}>#</th>
              <th scope="col" className={cell.th}>Question</th>
              <th scope="col" className={cell.th}>Source</th>
              <th scope="col" className={cell.th}>Answer</th>
              <th scope="col" className={cell.th}>Outcome</th>
              {blockable ? <th scope="col" className={cell.th}>Report</th> : null}
            </tr>
          </thead>
          <tbody>
            {session.questions.map((question) => (
              <tr key={question.id}>
                <td className={`${cell.td} ${cell.num}`}>{question.position}</td>
                <td className={`${cell.td} max-w-[420px]`}>
                  <p className="line-clamp-2 text-slate-900">{question.prompt || "(no text)"}</p>
                  <div className="text-[11px] text-slate-500">{question.subjectName}{question.topicName ? ` · ${question.topicName}` : ""}{question.flagged ? " · flagged by student" : ""}</div>
                </td>
                <td className={`${cell.td} text-[11.5px]`}>
                  {question.internalQuestionId && showKeys ? <Link href={`/admin/questions/${question.internalQuestionId}`} className="font-semibold hover:underline">Internal bank</Link> : question.sourceProvider}
                  <div className="mono-number break-all text-slate-500">{question.sourceQuestionId}</div>
                </td>
                <td className={`${cell.td} mono-number whitespace-nowrap`}>
                  {question.selected ?? "—"}{showKeys && (finished || session.kind === "practice") ? <span className="text-slate-500"> / key {question.correct}</span> : null}
                </td>
                <td className={cell.td}>{finished || session.sessionType === "practice" || session.sessionType === "revision" ? <Badge tone={OUTCOME_TONES[question.outcome]}>{humanize(question.outcome)}</Badge> : <span className="text-[11.5px] text-slate-500">After submission</span>}</td>
                {blockable ? (
                  <td className={cell.td}>
                    {question.sourceProvider !== "internal" && session.examCode && question.subjectSlug ? (
                      <ActionDialog
                        triggerLabel="Block"
                        title="Block this external question?"
                        description="It will be skipped in new sessions. This session and the provider's data are not changed."
                        confirmLabel="Block question"
                        confirmVariant="danger"
                        reasonLabel="What is wrong with it?"
                        action={blockQuestionAction.bind(null, { provider: question.sourceProvider, exam: session.examCode, subject: question.subjectSlug, sourceQuestionId: question.sourceQuestionId })}
                      />
                    ) : <span className="text-[11.5px] text-slate-400">—</span>}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  );
}
