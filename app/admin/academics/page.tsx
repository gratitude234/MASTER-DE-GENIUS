import Link from "next/link";
import { AdminPageHeader, DataTable, EmptyRow, Field, FilterBar, Panel, Stat, StatGrid, cell } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { fieldClasses } from "@/components/ui/variants";
import { loadAcademicReport } from "@/features/admin/analytics";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { accuracy, formatCount, formatDate, formatPercent, humanize } from "@/features/admin/format";
import { dateParam, endOfDayWat, hrefWith, oneOf, startOfDayWat, textParam, type SearchParams } from "@/features/admin/params";
import { loadQuestionCatalog } from "@/features/admin/questions";

export const dynamic = "force-dynamic";

const MIN_ATTEMPT_CHOICES = ["3", "5", "10", "25"] as const;

export default async function AdminAcademicsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("academics.view"), searchParams]);
  const filters = {
    exam: oneOf(textParam(params, "exam"), ["jamb", "waec"] as const),
    subject: textParam(params, "subject", 80),
    from: dateParam(params, "from"),
    to: dateParam(params, "to"),
    min: oneOf(textParam(params, "min"), MIN_ATTEMPT_CHOICES) ?? "5",
  };
  const until = filters.to ? endOfDayWat(filters.to) : new Date().toISOString();
  const since = filters.from ? startOfDayWat(filters.from) : new Date(Date.parse(until) - 30 * 86_400_000).toISOString();

  const catalog = await loadQuestionCatalog();
  let report: Awaited<ReturnType<typeof loadAcademicReport>> | null = null;
  let windowError: string | null = null;
  if (Date.parse(since) >= Date.parse(until) || Date.parse(until) - Date.parse(since) > 366 * 86_400_000) {
    windowError = "Choose a date range of up to one year, with the start before the end.";
  } else {
    report = await loadAcademicReport(admin.userId, { exam: filters.exam, subject: filters.subject, since, until, minAttempts: Number(filters.min) });
  }
  const editQuestions = can(admin, "questions.view");

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Academics"
        description="Where students struggle, from completed practice and submitted mocks. Accuracy counts unanswered questions as not correct, as student results do. Revision sets are excluded because they only contain questions a student already missed."
      />

      <FilterBar action="/admin/academics" resetHref="/admin/academics">
        <Field label="Exam">
          <Select name="exam" size="md" defaultValue={filters.exam ?? ""}>
            <option value="">All exams</option>
            <option value="jamb">JAMB</option>
            <option value="waec">WAEC</option>
          </Select>
        </Field>
        <Field label="Subject">
          <Select name="subject" size="md" defaultValue={filters.subject ?? ""}>
            <option value="">All subjects</option>
            {catalog.subjects.map((subject) => <option key={subject.id} value={subject.slug}>{subject.name}</option>)}
          </Select>
        </Field>
        <Field label="From">
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
        <Field label="Minimum attempts">
          <Select name="min" size="md" defaultValue={filters.min}>
            {MIN_ATTEMPT_CHOICES.map((value) => <option key={value} value={value}>{value}+</option>)}
          </Select>
        </Field>
      </FilterBar>

      {windowError ? <p className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-[12.5px] text-warning-800">{windowError}</p> : null}

      {report ? (
        <>
          <p className="text-[12px] text-slate-600">{formatDate(report.window.since)} to {formatDate(report.window.until)}. Topic and question rows need at least {report.window.min_attempts} answers.</p>
          <StatGrid className="xl:grid-cols-5">
            <Stat label="Questions answered" value={formatCount(report.totals.questions)} />
            <Stat label="Accuracy" value={formatPercent(accuracy(report.totals.correct, report.totals.questions))} />
            <Stat label="Left unanswered" value={formatPercent(accuracy(report.totals.unanswered, report.totals.questions))} />
            <Stat label="Sessions" value={formatCount(report.totals.sessions)} />
            <Stat label="Students" value={formatCount(report.totals.students)} />
          </StatGrid>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Subjects" description="Weakest first. Volume shows where practice is concentrated." bodyClassName="p-0">
              <DataTable label="Subject performance" minWidth={560}>
                <thead><tr><th scope="col" className={cell.th}>Subject</th><th scope="col" className={`${cell.th} text-right`}>Answers</th><th scope="col" className={`${cell.th} text-right`}>Unanswered</th><th scope="col" className={`${cell.th} text-right`}>Students</th><th scope="col" className={`${cell.th} text-right`}>Accuracy</th></tr></thead>
                <tbody>
                  {report.subjects.length ? report.subjects.map((row) => (
                    <tr key={`${row.exam_code}-${row.subject_slug}`}>
                      <td className={cell.td}><Link href={hrefWith("/admin/academics", { ...filters, from: filters.from, to: filters.to }, { exam: row.exam_code, subject: row.subject_slug })} className="font-semibold hover:underline">{row.subject_name}</Link><div className="text-[11px] text-slate-500">{row.exam_code.toUpperCase()}</div></td>
                      <td className={`${cell.td} ${cell.num}`}>{formatCount(row.questions)}</td>
                      <td className={`${cell.td} ${cell.num}`}>{formatCount(row.unanswered ?? 0)}</td>
                      <td className={`${cell.td} ${cell.num}`}>{formatCount(row.students)}</td>
                      <td className={`${cell.td} ${cell.num} font-semibold`}>{row.accuracy}%</td>
                    </tr>
                  )) : <EmptyRow colSpan={5}>No completed work in this window.</EmptyRow>}
                </tbody>
              </DataTable>
            </Panel>

            <Panel title="Lowest-accuracy topics" description="Topics come from the question source; external providers often send none, shown as Uncategorised." bodyClassName="p-0">
              <DataTable label="Topic performance" minWidth={520}>
                <thead><tr><th scope="col" className={cell.th}>Topic</th><th scope="col" className={`${cell.th} text-right`}>Answers</th><th scope="col" className={`${cell.th} text-right`}>Students</th><th scope="col" className={`${cell.th} text-right`}>Accuracy</th></tr></thead>
                <tbody>
                  {report.topics.length ? report.topics.slice(0, 25).map((row) => (
                    <tr key={`${row.exam_code}-${row.subject_slug}-${row.topic_slug ?? "none"}`}>
                      <td className={cell.td}>{row.topic_name}<div className="text-[11px] text-slate-500">{row.exam_code.toUpperCase()} · {row.subject_name}</div></td>
                      <td className={`${cell.td} ${cell.num}`}>{formatCount(row.questions)}</td>
                      <td className={`${cell.td} ${cell.num}`}>{formatCount(row.students)}</td>
                      <td className={`${cell.td} ${cell.num} font-semibold`}>{row.accuracy}%</td>
                    </tr>
                  )) : <EmptyRow colSpan={4}>No topic reaches the minimum attempts.</EmptyRow>}
                </tbody>
              </DataTable>
            </Panel>
          </div>

          <Panel title="Questions with unusually high failure rates" description="Very low accuracy across many students can mean a wrong answer key or an unclear question." bodyClassName="p-0">
            <DataTable label="Most-failed questions" minWidth={900}>
              <thead><tr><th scope="col" className={cell.th}>Question</th><th scope="col" className={cell.th}>Subject</th><th scope="col" className={cell.th}>Source</th><th scope="col" className={`${cell.th} text-right`}>Attempts</th><th scope="col" className={`${cell.th} text-right`}>Students</th><th scope="col" className={`${cell.th} text-right`}>Accuracy</th></tr></thead>
              <tbody>
                {report.questions.length ? report.questions.slice(0, 30).map((row) => {
                  const href = row.source_provider === "internal" && row.internal_question_id
                    ? `/admin/questions/${row.internal_question_id}`
                    : hrefWith("/admin/questions/external", {}, { provider: row.source_provider, exam: row.exam_code, subject: row.subject_slug, sourceQuestionId: row.source_question_id });
                  return (
                    <tr key={`${row.source_provider}-${row.exam_code}-${row.subject_slug}-${row.source_question_id}`}>
                      <td className={`${cell.td} max-w-[380px]`}>
                        {editQuestions ? <Link href={href} className="line-clamp-2 font-semibold text-slate-950 hover:underline">{row.prompt || "(no text)"}</Link> : <p className="line-clamp-2">{row.prompt}</p>}
                        {row.is_blocked ? <Badge tone="danger" className="mt-1">Blocked</Badge> : null}
                      </td>
                      <td className={cell.td}>{row.exam_code.toUpperCase()} · {row.subject_name}<div className="text-[11px] text-slate-500">{row.topic_name ?? "Uncategorised"}</div></td>
                      <td className={`${cell.td} text-[11.5px]`}>{humanize(row.source_provider)}<div className="mono-number break-all text-slate-500">{row.source_question_id}</div></td>
                      <td className={`${cell.td} ${cell.num}`}>{formatCount(row.attempts)}</td>
                      <td className={`${cell.td} ${cell.num}`}>{formatCount(row.students)}</td>
                      <td className={`${cell.td} ${cell.num} font-semibold`}>{row.accuracy}%</td>
                    </tr>
                  );
                }) : <EmptyRow colSpan={6}>No question reaches the minimum attempts.</EmptyRow>}
              </tbody>
            </DataTable>
          </Panel>

          <Panel title="Repeated mistakes" description="Times a student got the same question wrong at least twice in this window, grouped by topic." bodyClassName="p-0">
            <DataTable label="Repeated mistakes by topic" minWidth={520}>
              <thead><tr><th scope="col" className={cell.th}>Topic</th><th scope="col" className={`${cell.th} text-right`}>Repeat misses</th><th scope="col" className={`${cell.th} text-right`}>Students</th></tr></thead>
              <tbody>
                {report.repeated.length ? report.repeated.map((row) => (
                  <tr key={`${row.exam_code}-${row.subject_name}-${row.topic_name}`}>
                    <td className={cell.td}>{row.topic_name}<div className="text-[11px] text-slate-500">{row.exam_code.toUpperCase()} · {row.subject_name}</div></td>
                    <td className={`${cell.td} ${cell.num}`}>{formatCount(row.repeat_misses)}</td>
                    <td className={`${cell.td} ${cell.num}`}>{formatCount(row.students)}</td>
                  </tr>
                )) : <EmptyRow colSpan={3}>No student missed the same question twice in this window.</EmptyRow>}
              </tbody>
            </DataTable>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
