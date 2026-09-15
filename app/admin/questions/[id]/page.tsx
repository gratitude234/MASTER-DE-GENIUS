import { notFound } from "next/navigation";
import { ActionDialog } from "@/components/admin/action-dialog";
import { AdminPageHeader, DefinitionGrid, Panel } from "@/components/admin/admin-ui";
import { QuestionEditor } from "@/components/admin/question-editor";
import { QuestionStatusBadge } from "@/components/admin/status-badges";
import { setQuestionStatusAction } from "@/features/admin/actions/operations";
import { auditActionLabel } from "@/features/admin/audit";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { loadEntityHistory } from "@/features/admin/directory";
import { formatCount, formatDateTime, humanize } from "@/features/admin/format";
import { isUuid } from "@/features/admin/params";
import { loadInternalQuestion, loadQuestionCatalog } from "@/features/admin/questions";

export const dynamic = "force-dynamic";

export default async function AdminQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const [admin, { id }] = await Promise.all([requireAdminPermission("questions.view"), params]);
  if (!isUuid(id)) notFound();

  const [detail, catalog, history] = await Promise.all([
    loadInternalQuestion(admin.userId, id),
    loadQuestionCatalog(),
    loadEntityHistory(admin.userId, "question", id, 30),
  ]);
  if (!detail) notFound();

  const { question } = detail;
  const manage = can(admin, "questions.manage");
  const status = question.status;
  const exam = catalog.exams.find((item) => item.id === question.exam_body_id);
  const subject = catalog.subjects.find((item) => item.id === question.subject_id);
  const topic = catalog.topics.find((item) => item.id === question.topic_id);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Question"
        breadcrumbs={[{ href: "/admin/questions", label: "Questions" }]}
        description={`${exam?.name ?? "Unknown exam"} · ${subject?.name ?? "Unknown subject"}${topic ? ` · ${topic.name}` : ""}`}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <QuestionStatusBadge status={status} />
            {manage && status !== "active" ? (
              <ActionDialog
                triggerLabel="Activate"
                title="Serve this question to students?"
                description="It must have at least two options and a correct answer among them."
                confirmLabel="Activate"
                reasonLabel="Note (optional)"
                reasonRequired={false}
                action={setQuestionStatusAction.bind(null, id, "active")}
              />
            ) : null}
            {manage && status !== "flagged" ? (
              <ActionDialog
                triggerLabel="Flag for review"
                title="Flag this question?"
                description="A flagged question is not served. Use this when a student or reviewer has reported a problem."
                confirmLabel="Flag question"
                reasonLabel="What is wrong with it?"
                action={setQuestionStatusAction.bind(null, id, "flagged")}
              />
            ) : null}
            {manage && status !== "disabled" ? (
              <ActionDialog
                triggerLabel="Disable"
                title="Disable this question?"
                description="It stops being served. Past sessions that used it are unaffected, and it can be reactivated later."
                confirmLabel="Disable question"
                confirmVariant="danger"
                reasonLabel="Reason"
                action={setQuestionStatusAction.bind(null, id, "disabled")}
              />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title={manage ? "Edit" : "Content"}>
          {manage ? (
            <QuestionEditor
              catalog={catalog}
              questionId={id}
              isActive={status === "active"}
              hasPassage={Boolean(question.passage_id)}
              initial={{
                examBodyId: question.exam_body_id,
                subjectId: question.subject_id,
                topicId: question.topic_id,
                year: question.year,
                difficulty: question.difficulty,
                questionText: question.question_text,
                explanation: question.explanation,
                options: detail.options.map((option) => option.text),
                correctOptionKey: question.correct_option_key,
                status,
              }}
            />
          ) : (
            <div className="space-y-3">
              <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-slate-900">{question.question_text}</p>
              <ol className="space-y-1.5">
                {detail.options.map((option) => (
                  <li key={option.key} className={`rounded-lg border px-3 py-2 text-[12.5px] ${option.key === question.correct_option_key ? "border-success-200 bg-success-50 text-success-700" : "border-slate-200"}`}>
                    <span className="font-bold">{option.key}.</span> {option.text}
                  </li>
                ))}
              </ol>
              {question.explanation ? <p className="rounded-xl bg-slate-50 p-3 text-[12.5px] text-slate-700">{question.explanation}</p> : null}
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Details">
            <DefinitionGrid
              items={[
                ["Source", question.source_provider === "internal" ? "Internal" : `Imported from ${question.source_provider}`],
                ["Year", question.year ?? "Any"],
                ["Difficulty", humanize(question.difficulty)],
                ["Times served", formatCount(detail.timesServed)],
                ["Passage", detail.passageTitle ?? "None"],
                ["Images and diagrams", formatCount(detail.assetCount)],
                ["Created by", detail.createdBy ?? "Seed or import"],
                ["Updated", formatDateTime(question.updated_at)],
              ]}
            />
            {question.review_notes ? <p className="mt-3 rounded-xl bg-warning-50 p-3 text-[12px] text-warning-800">Review note: {question.review_notes}</p> : null}
            {detail.passageTitle || detail.assetCount ? <p className="mt-3 text-[11.5px] text-slate-500">Passages and images are kept as they are when the question is edited here.</p> : null}
          </Panel>
          <Panel title="History">
            {history.length ? (
              <ol className="space-y-2.5">
                {history.map((entry) => (
                  <li key={entry.id} className="text-[12.5px] text-slate-700">
                    <span className="font-semibold text-slate-950">{auditActionLabel(entry.action)}</span>
                    {entry.action === "question.status_change" ? ` · ${humanize(String(entry.before?.status ?? ""))} → ${humanize(String(entry.after?.status ?? ""))}` : ""}
                    <div className="text-[11px] text-slate-500">{entry.actor} · {formatDateTime(entry.createdAt)}</div>
                    {entry.reason ? <div className="text-[11.5px] text-slate-600">“{entry.reason}”</div> : null}
                  </li>
                ))}
              </ol>
            ) : <p className="text-[13px] text-slate-600">No admin changes recorded.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
