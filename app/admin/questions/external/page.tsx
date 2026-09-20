import Form from "next/form";
import Link from "next/link";
import { ActionDialog } from "@/components/admin/action-dialog";
import { AdminPageHeader, DataTable, EmptyRow, Field, Pagination, Panel, ResultCount, cell } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { buttonClasses, fieldClasses } from "@/components/ui/variants";
import { blockQuestionAction, liftQuestionBlockAction } from "@/features/admin/actions/operations";
import { loadAcademicReport } from "@/features/admin/analytics";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { formatCount, formatDateTime } from "@/features/admin/format";
import { daysAgoIso, hrefWith, oneOf, pageParam, textParam, type SearchParams } from "@/features/admin/params";
import { inspectExternalQuestion, listQuestionBlocks, loadQuestionCatalog } from "@/features/admin/questions";
import { QuestionTabs } from "@/components/admin/question-tabs";

export const dynamic = "force-dynamic";

const PROVIDERS = [["aloc_station", "ALOC Station"], ["sdash", "Sdash"], ["aloc", "ALOC (legacy)"]] as const;

export default async function ExternalQuestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("questions.view"), searchParams]);
  const manage = can(admin, "questions.manage");
  const key = {
    provider: oneOf(textParam(params, "provider"), PROVIDERS.map(([value]) => value)),
    exam: textParam(params, "exam", 20)?.toLowerCase(),
    subject: textParam(params, "subject", 80)?.toLowerCase(),
    sourceQuestionId: textParam(params, "sourceQuestionId", 200),
  };
  const blockState = textParam(params, "blocks") === "lifted" ? "lifted" : "active";
  const page = pageParam(params);
  const complete = Boolean(key.provider && key.exam && key.subject && key.sourceQuestionId);

  const [catalog, blocks, inspection, report] = await Promise.all([
    loadQuestionCatalog(),
    listQuestionBlocks(admin.userId, blockState, page),
    complete ? inspectExternalQuestion({ provider: key.provider!, exam: key.exam!, subject: key.subject!, sourceQuestionId: key.sourceQuestionId! }) : Promise.resolve(null),
    can(admin, "academics.view")
      ? loadAcademicReport(admin.userId, { since: daysAgoIso(30), until: new Date().toISOString(), minAttempts: 10 }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const problematic = (report?.questions ?? []).filter((row) => row.source_provider !== "internal" && row.source_provider !== "revision" && row.accuracy < 40).slice(0, 15);
  const subjectName = new Map(catalog.subjects.map((subject) => [subject.slug, subject.name]));
  const inspectHref = (row: { source_provider: string; exam_code: string; subject_slug: string; source_question_id: string }) =>
    hrefWith("/admin/questions/external", {}, { provider: row.source_provider, exam: row.exam_code, subject: row.subject_slug, sourceQuestionId: row.source_question_id });

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Questions"
        description="Questions supplied by external providers are never edited here. A broken one is blocked, so Master De Genius stops putting it into new sessions."
      />
      <QuestionTabs current="external" />

      <Panel title="Inspect a question" description="Shows the question exactly as it was frozen into a student's session. The provider is not called.">
        <Form action="/admin/questions/external" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Provider">
            <Select name="provider" size="md" defaultValue={key.provider ?? "aloc_station"}>
              {PROVIDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Exam">
            <Select name="exam" size="md" defaultValue={key.exam ?? "jamb"}>
              {catalog.exams.map((exam) => <option key={exam.id} value={exam.code}>{exam.name}</option>)}
            </Select>
          </Field>
          <Field label="Subject">
            <Select name="subject" size="md" defaultValue={key.subject ?? ""} required>
              <option value="">Choose</option>
              {catalog.subjects.map((subject) => <option key={subject.id} value={subject.slug}>{subject.name}</option>)}
            </Select>
          </Field>
          <Field label="Provider question ID">
            <input name="sourceQuestionId" defaultValue={key.sourceQuestionId ?? ""} required maxLength={200} className={fieldClasses({ size: "md" })} />
          </Field>
          <div className="flex items-end"><button type="submit" className={buttonClasses({ variant: "dark", size: "md", fullWidth: true })}>Inspect</button></div>
        </Form>

        {complete ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            {inspection ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {inspection.activeBlock ? <Badge tone="danger">Blocked</Badge> : <Badge tone="success">Being served</Badge>}
                  <span className="text-[11.5px] text-slate-500">Last served {formatDateTime(inspection.lastServedAt)}</span>
                </div>
                {inspection.question.passage?.body ? <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[12px] text-slate-700">{inspection.question.passage.body}</p> : null}
                {inspection.question.instruction ? <p className="whitespace-pre-wrap text-[12px] text-slate-600">{inspection.question.instruction}</p> : null}
                <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-slate-900">{inspection.question.prompt}</p>
                {!inspection.integrity.valid ? (
                  <InlineAlert tone="warning">
                    This question is missing context a student needs ({inspection.integrity.reason}
                    {inspection.integrity.detail ? `: ${inspection.integrity.detail}` : ""}). New sessions already skip it.
                  </InlineAlert>
                ) : null}
                <ol className="space-y-1.5">
                  {inspection.question.options.map((option) => (
                    <li key={option.key} className={`rounded-lg border px-3 py-2 text-[12.5px] ${option.key === inspection.correctOptionKey ? "border-success-200 bg-success-50 text-success-700" : "border-slate-200"}`}>
                      <span className="font-bold">{option.key}.</span> {option.text}{option.key === inspection.correctOptionKey ? " — provider's answer" : ""}
                    </li>
                  ))}
                </ol>
                {inspection.explanation ? <p className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-700">{inspection.explanation}</p> : null}
                {inspection.activeBlock ? (
                  <InlineAlert tone="warning">Blocked {formatDateTime(inspection.activeBlock.createdAt)}: {inspection.activeBlock.reason}</InlineAlert>
                ) : manage ? (
                  <ActionDialog
                    triggerLabel="Block this question"
                    triggerVariant="dark"
                    title="Block this question?"
                    description="It will be skipped in every new practice and mock session. Sessions already started are not changed, and the provider's data is untouched."
                    confirmLabel="Block question"
                    confirmVariant="danger"
                    reasonLabel="What is wrong with it?"
                    action={blockQuestionAction.bind(null, { provider: key.provider!, exam: key.exam!, subject: key.subject!, sourceQuestionId: key.sourceQuestionId! })}
                  />
                ) : null}
              </div>
            ) : (
              <InlineAlert tone="brand">No session has served that question for {subjectName.get(key.subject!) ?? key.subject}, so there is nothing to inspect yet.</InlineAlert>
            )}
          </div>
        ) : null}
      </Panel>

      {report ? (
        <Panel title="Most-missed external questions" description="Last 30 days, at least 10 attempts, under 40% answered correctly. A very low rate often means a wrong answer key." bodyClassName="p-0">
          <DataTable label="Most-missed external questions" minWidth={820}>
            <thead><tr><th scope="col" className={cell.th}>Question</th><th scope="col" className={cell.th}>Subject</th><th scope="col" className={`${cell.th} text-right`}>Attempts</th><th scope="col" className={`${cell.th} text-right`}>Correct</th><th scope="col" className={cell.th}>State</th></tr></thead>
            <tbody>
              {problematic.length ? problematic.map((row) => (
                <tr key={`${row.source_provider}-${row.exam_code}-${row.subject_slug}-${row.source_question_id}`}>
                  <td className={`${cell.td} max-w-[380px]`}>
                    <Link href={inspectHref(row)} className="line-clamp-2 font-semibold text-slate-950 hover:underline">{row.prompt || "(no text)"}</Link>
                    <div className="mono-number text-[11px] text-slate-500">{row.source_provider} · {row.source_question_id}</div>
                  </td>
                  <td className={cell.td}>{row.exam_code.toUpperCase()} · {row.subject_name}</td>
                  <td className={`${cell.td} ${cell.num}`}>{formatCount(row.attempts)}</td>
                  <td className={`${cell.td} ${cell.num}`}>{row.accuracy}%</td>
                  <td className={cell.td}>{row.is_blocked ? <Badge tone="danger">Blocked</Badge> : <Badge tone="neutral">Served</Badge>}</td>
                </tr>
              )) : <EmptyRow colSpan={5}>No external question meets that threshold.</EmptyRow>}
            </tbody>
          </DataTable>
        </Panel>
      ) : null}

      <section aria-labelledby="blocklist-heading">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="blocklist-heading" className="text-[13px] font-bold text-slate-950">Blocklist</h2>
          <div className="flex gap-2">
            <Link href="/admin/questions/external" className={buttonClasses({ variant: blockState === "active" ? "dark" : "ghost", size: "sm" })}>Active</Link>
            <Link href="/admin/questions/external?blocks=lifted" className={buttonClasses({ variant: blockState === "lifted" ? "dark" : "ghost", size: "sm" })}>Lifted</Link>
          </div>
        </div>
        <ResultCount total={blocks.total} shown={blocks.rows.length} noun="block" />
        <DataTable label="Blocked questions" minWidth={940}>
          <thead><tr><th scope="col" className={cell.th}>Question</th><th scope="col" className={cell.th}>Subject</th><th scope="col" className={cell.th}>Reason</th><th scope="col" className={cell.th}>Blocked</th><th scope="col" className={cell.th}>{blockState === "active" ? "Action" : "Lifted"}</th></tr></thead>
          <tbody>
            {blocks.rows.length ? blocks.rows.map((block) => (
              <tr key={block.id}>
                <td className={cell.td}>
                  <Link href={inspectHref({ source_provider: block.source_provider, exam_code: block.exam_code, subject_slug: block.subject_slug, source_question_id: block.source_question_id })} className="mono-number font-semibold text-slate-950 hover:underline">{block.source_question_id}</Link>
                  <div className="text-[11px] text-slate-500">{block.source_provider}</div>
                </td>
                <td className={cell.td}>{block.exam_code.toUpperCase()} · {subjectName.get(block.subject_slug) ?? block.subject_slug}</td>
                <td className={`${cell.td} max-w-[280px] text-[11.5px]`}>{block.reason}</td>
                <td className={`${cell.td} text-[11.5px]`}>{block.blockedByName}<div className="text-slate-500">{formatDateTime(block.created_at)}</div></td>
                <td className={`${cell.td} text-[11.5px]`}>
                  {blockState === "active" ? (
                    manage ? (
                      <ActionDialog
                        triggerLabel="Lift block"
                        title="Serve this question again?"
                        description="New sessions may include it again."
                        confirmLabel="Lift block"
                        reasonLabel="Why is it safe to serve now?"
                        action={liftQuestionBlockAction.bind(null, block.id)}
                      />
                    ) : "—"
                  ) : (
                    <>{block.liftedByName}<div className="text-slate-500">{formatDateTime(block.lifted_at)}</div>{block.lift_reason ? <div className="text-slate-600">{block.lift_reason}</div> : null}</>
                  )}
                </td>
              </tr>
            )) : <EmptyRow colSpan={5}>{blockState === "active" ? "No questions are blocked." : "No blocks have been lifted."}</EmptyRow>}
          </tbody>
        </DataTable>
        <Pagination page={page} pageCount={blocks.pageCount} hrefFor={(next) => hrefWith("/admin/questions/external", { blocks: blockState === "lifted" ? "lifted" : undefined }, { page: next })} />
      </section>
    </div>
  );
}
