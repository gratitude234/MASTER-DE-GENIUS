import Link from "next/link";
import { AdminPageHeader, DataTable, EmptyRow, Field, FilterBar, Pagination, ResultCount, TextLink, cell } from "@/components/admin/admin-ui";
import { SearchField } from "@/components/admin/search-field";
import { SessionStatusBadge } from "@/components/admin/status-badges";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { fieldClasses } from "@/components/ui/variants";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { formatDateTime, humanize } from "@/features/admin/format";
import { dateParam, endOfDayWat, hrefWith, isUuid, oneOf, pageParam, startOfDayWat, textParam, type SearchParams } from "@/features/admin/params";
import { loadQuestionCatalog } from "@/features/admin/questions";
import { SESSION_KINDS, SESSION_STATES, listSessions } from "@/features/admin/sessions";

export const dynamic = "force-dynamic";

const STATE_LABELS: Record<(typeof SESSION_STATES)[number], string> = {
  active: "In progress",
  overdue: "Overdue (time up, not submitted)",
  finished: "Completed / submitted",
  abandoned: "Expired or abandoned",
};

export default async function AdminExamsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("sessions.view"), searchParams]);
  const userIdParam = textParam(params, "userId", 36);
  const filters = {
    kind: oneOf(textParam(params, "kind"), SESSION_KINDS),
    state: oneOf(textParam(params, "state"), SESSION_STATES),
    exam: oneOf(textParam(params, "exam"), ["jamb", "waec"] as const),
    subject: textParam(params, "subject", 80),
    search: textParam(params, "search"),
    userId: isUuid(userIdParam) ? userIdParam : undefined,
    from: dateParam(params, "from"),
    to: dateParam(params, "to"),
  };
  // Without a date or a student, the list is bounded to the last 30 days so an
  // unfiltered view never ranks every session ever created.
  const bounded = !filters.from && !filters.to && !filters.userId && !filters.state;
  const page = pageParam(params);

  const [{ rows, total, pageCount }, catalog] = await Promise.all([
    listSessions(admin.userId, {
      ...filters,
      from: filters.from ? startOfDayWat(filters.from) : bounded ? new Date(Date.now() - 30 * 86_400_000).toISOString() : undefined,
      to: filters.to ? endOfDayWat(filters.to) : undefined,
    }, page),
    loadQuestionCatalog(),
  ]);
  const now = Date.now();

  return (
    <div>
      <AdminPageHeader title="Exams & Sessions" description="Diagnose practice sessions and mocks for support. Answers and scores are read-only." />
      {filters.userId ? <InlineAlert tone="brand" className="mb-4">Showing one student&apos;s sessions. <Link href="/admin/exams" className="underline">Show everyone</Link></InlineAlert> : null}

      <FilterBar action="/admin/exams" resetHref="/admin/exams">
        {filters.userId ? <input type="hidden" name="userId" value={filters.userId} /> : null}
        <Field label="Student" className="sm:col-span-2">
          <SearchField label="Search by student" defaultValue={filters.search} placeholder="Student name or email" />
        </Field>
        <Field label="Type">
          <Select name="kind" size="md" defaultValue={filters.kind ?? ""}>
            <option value="">All types</option>
            <option value="practice">Practice</option>
            <option value="timed">Timed practice</option>
            <option value="revision">Revision</option>
            <option value="mock">Full mock</option>
          </Select>
        </Field>
        <Field label="State">
          <Select name="state" size="md" defaultValue={filters.state ?? ""}>
            <option value="">Any state</option>
            {SESSION_STATES.map((value) => <option key={value} value={value}>{STATE_LABELS[value]}</option>)}
          </Select>
        </Field>
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
        <Field label="Started from">
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
        <Field label="Started to">
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
      </FilterBar>

      {bounded ? <p className="mb-2 text-[11.5px] text-slate-500">Showing sessions started in the last 30 days. Choose dates, a state or a student to look further back.</p> : null}
      <ResultCount total={total} shown={rows.length} noun="session" />
      <DataTable label="Sessions" minWidth={1040}>
        <thead>
          <tr>
            <th scope="col" className={cell.th}>Session</th>
            <th scope="col" className={cell.th}>Student</th>
            <th scope="col" className={cell.th}>Subjects</th>
            <th scope="col" className={cell.th}>Status</th>
            <th scope="col" className={`${cell.th} text-right`}>Answered</th>
            <th scope="col" className={`${cell.th} text-right`}>Score</th>
            <th scope="col" className={cell.th}>Started</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => {
            const overdue = row.status === "in_progress" && Boolean(row.expires_at) && Date.parse(row.expires_at!) <= now;
            const finished = row.status === "completed" || row.status === "submitted";
            return (
              <tr key={row.session_id} className="hover:bg-slate-50/70">
                <td className={cell.td}>
                  <TextLink href={`/admin/exams/${row.session_kind}/${row.session_id}`}>{humanize(row.session_type)}</TextLink>
                  <div className="text-[11px] text-slate-500">{row.exam_code?.toUpperCase() ?? "—"} · {row.source_provider}</div>
                </td>
                <td className={cell.td}>
                  {can(admin, "students.view") ? <Link href={`/admin/students/${row.user_id}`} className="font-semibold text-slate-950 hover:underline">{row.student_name?.trim() || "Unnamed"}</Link> : <span className="font-semibold">{row.student_name?.trim() || "Unnamed"}</span>}
                  <div className="text-[11px] text-slate-500">{row.student_email ?? ""}</div>
                </td>
                <td className={`${cell.td} max-w-[220px] text-[11.5px]`}>{row.subject_names ?? "—"}</td>
                <td className={cell.td}><SessionStatusBadge status={row.status} overdue={overdue} /></td>
                <td className={`${cell.td} ${cell.num}`}>{row.answered_count}/{row.question_count}</td>
                <td className={`${cell.td} ${cell.num}`}>{finished ? `${Math.round((100 * row.correct_count) / Math.max(1, row.question_count))}%` : "—"}</td>
                <td className={`${cell.td} whitespace-nowrap`}>{formatDateTime(row.started_at)}</td>
              </tr>
            );
          }) : <EmptyRow colSpan={7}>No sessions match these filters.</EmptyRow>}
        </tbody>
      </DataTable>
      <Pagination page={page} pageCount={pageCount} hrefFor={(next) => hrefWith("/admin/exams", filters, { page: next })} />
      <p className="mt-3 text-[11.5px] text-slate-500">Score is correct answers over all questions, with unanswered counted as not correct — the same rule as the student&apos;s result page. Mock scaled scores are shown on the session.</p>
    </div>
  );
}
