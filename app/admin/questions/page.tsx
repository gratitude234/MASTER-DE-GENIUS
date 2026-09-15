import Link from "next/link";
import { AdminPageHeader, DataTable, EmptyRow, Field, FilterBar, Pagination, ResultCount, cell } from "@/components/admin/admin-ui";
import { QuestionTabs } from "@/components/admin/question-tabs";
import { SearchField } from "@/components/admin/search-field";
import { QuestionStatusBadge } from "@/components/admin/status-badges";
import { Select } from "@/components/ui/select";
import { buttonClasses, fieldClasses } from "@/components/ui/variants";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { formatDate, humanize } from "@/features/admin/format";
import { hrefWith, oneOf, pageParam, textParam, type SearchParams } from "@/features/admin/params";
import { QUESTION_STATUSES, listInternalQuestions, loadQuestionCatalog } from "@/features/admin/questions";

export const dynamic = "force-dynamic";

export default async function AdminQuestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("questions.view"), searchParams]);
  const catalog = await loadQuestionCatalog();
  const yearText = textParam(params, "year", 4);
  const filters = {
    exam: textParam(params, "exam", 20),
    subject: textParam(params, "subject", 80),
    status: oneOf(textParam(params, "status"), QUESTION_STATUSES),
    year: yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : undefined,
    search: textParam(params, "search"),
  };
  const page = pageParam(params);
  const { rows, total, pageCount } = await listInternalQuestions(catalog, filters, page);
  const linkFilters = { ...filters, year: filters.year ? String(filters.year) : undefined };

  return (
    <div>
      <AdminPageHeader
        title="Questions"
        description="Master De Genius's own question bank. Questions are disabled rather than deleted, so every past session keeps its history."
        actions={can(admin, "questions.manage") ? <Link href="/admin/questions/new" className={buttonClasses({ variant: "dark", size: "sm" })}>New question</Link> : undefined}
      />
      <QuestionTabs current="internal" />

      <FilterBar action="/admin/questions" resetHref="/admin/questions">
        <Field label="Search" className="sm:col-span-2">
          <SearchField label="Search question text" defaultValue={filters.search} placeholder="Words in the question" />
        </Field>
        <Field label="Exam">
          <Select name="exam" size="md" defaultValue={filters.exam ?? ""}>
            <option value="">All exams</option>
            {catalog.exams.map((exam) => <option key={exam.id} value={exam.code}>{exam.name}</option>)}
          </Select>
        </Field>
        <Field label="Subject">
          <Select name="subject" size="md" defaultValue={filters.subject ?? ""}>
            <option value="">All subjects</option>
            {catalog.subjects.map((subject) => <option key={subject.id} value={subject.slug}>{subject.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" size="md" defaultValue={filters.status ?? ""}>
            <option value="">All statuses</option>
            {QUESTION_STATUSES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
          </Select>
        </Field>
        <Field label="Year">
          <input name="year" inputMode="numeric" defaultValue={filters.year ?? ""} placeholder="Any" className={fieldClasses({ size: "md" })} />
        </Field>
      </FilterBar>

      <ResultCount total={total} shown={rows.length} noun="question" />
      <DataTable label="Internal questions" minWidth={900}>
        <thead>
          <tr>
            <th scope="col" className={cell.th}>Question</th>
            <th scope="col" className={cell.th}>Exam & subject</th>
            <th scope="col" className={cell.th}>Year</th>
            <th scope="col" className={cell.th}>Difficulty</th>
            <th scope="col" className={cell.th}>Status</th>
            <th scope="col" className={cell.th}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50/70">
              <td className={`${cell.td} max-w-[420px]`}>
                <Link href={`/admin/questions/${row.id}`} className="line-clamp-2 font-semibold text-slate-950 hover:text-brand-600 hover:underline">{row.question_text}</Link>
                {row.source_provider !== "internal" ? <div className="text-[11px] text-slate-500">Imported from {row.source_provider}</div> : null}
              </td>
              <td className={cell.td}>{row.examName} · {row.subjectName}<div className="text-[11px] text-slate-500">{row.topicName ?? "No topic"}</div></td>
              <td className={`${cell.td} mono-number`}>{row.year ?? "—"}</td>
              <td className={cell.td}>{humanize(row.difficulty)}</td>
              <td className={cell.td}><QuestionStatusBadge status={row.status} /></td>
              <td className={`${cell.td} whitespace-nowrap`}>{formatDate(row.updated_at)}</td>
            </tr>
          )) : <EmptyRow colSpan={6}>No internal questions match these filters.</EmptyRow>}
        </tbody>
      </DataTable>
      <Pagination page={page} pageCount={pageCount} hrefFor={(next) => hrefWith("/admin/questions", linkFilters, { page: next })} />
    </div>
  );
}
