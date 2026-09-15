import Link from "next/link";
import { AdminPageHeader, DataTable, EmptyRow, Field, FilterBar, Pagination, ResultCount, cell } from "@/components/admin/admin-ui";
import { SearchField } from "@/components/admin/search-field";
import { PlanBadge } from "@/components/admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { requireAdminPermission } from "@/features/admin/auth";
import { formatCount, formatDate, formatRelative } from "@/features/admin/format";
import { hrefWith, oneOf, pageParam, textParam, type SearchParams } from "@/features/admin/params";
import { STUDENT_ACTIVITY_FILTERS, STUDENT_PLAN_FILTERS, STUDENT_SORTS, listStudents } from "@/features/admin/students";

export const dynamic = "force-dynamic";

const ACTIVITY_LABELS: Record<(typeof STUDENT_ACTIVITY_FILTERS)[number], string> = {
  active_7d: "Active in 7 days",
  active_30d: "Active in 30 days",
  inactive_30d: "Inactive 30+ days",
  never: "Never started a session",
};
const SORT_LABELS: Record<(typeof STUDENT_SORTS)[number], string> = {
  joined_desc: "Newest first",
  joined_asc: "Oldest first",
  active_desc: "Recently active",
  name_asc: "Name A–Z",
};

export default async function AdminStudentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("students.view"), searchParams]);
  const filters = {
    search: textParam(params, "search"),
    exam: oneOf(textParam(params, "exam"), ["jamb", "waec"] as const),
    plan: oneOf(textParam(params, "plan"), STUDENT_PLAN_FILTERS),
    activity: oneOf(textParam(params, "activity"), STUDENT_ACTIVITY_FILTERS),
    sort: oneOf(textParam(params, "sort"), STUDENT_SORTS),
  };
  const page = pageParam(params);
  const { rows, total, pageCount } = await listStudents(admin.userId, filters, page);

  return (
    <div>
      <AdminPageHeader title="Students" description="Find a student, check their plan and preparation, and open their profile." />

      <FilterBar action="/admin/students" resetHref="/admin/students">
        <Field label="Search" className="sm:col-span-2">
          <SearchField label="Search students" defaultValue={filters.search} placeholder="Name, email or account ID" />
        </Field>
        <Field label="Exam">
          <Select name="exam" size="md" defaultValue={filters.exam ?? ""}>
            <option value="">All exams</option>
            <option value="jamb">JAMB</option>
            <option value="waec">WAEC</option>
          </Select>
        </Field>
        <Field label="Plan">
          <Select name="plan" size="md" defaultValue={filters.plan ?? ""}>
            <option value="">All plans</option>
            <option value="master">Master (active)</option>
            <option value="free">Free</option>
            <option value="lapsed">Master expired</option>
          </Select>
        </Field>
        <Field label="Activity">
          <Select name="activity" size="md" defaultValue={filters.activity ?? ""}>
            <option value="">Any activity</option>
            {STUDENT_ACTIVITY_FILTERS.map((value) => <option key={value} value={value}>{ACTIVITY_LABELS[value]}</option>)}
          </Select>
        </Field>
        <Field label="Sort">
          <Select name="sort" size="md" defaultValue={filters.sort ?? "joined_desc"}>
            {STUDENT_SORTS.map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
          </Select>
        </Field>
      </FilterBar>

      <ResultCount total={total} shown={rows.length} noun="student" />
      <DataTable label="Students" minWidth={980}>
        <thead>
          <tr>
            <th scope="col" className={cell.th}>Student</th>
            <th scope="col" className={cell.th}>Exam</th>
            <th scope="col" className={cell.th}>Plan</th>
            <th scope="col" className={cell.th}>Subjects</th>
            <th scope="col" className={cell.th}>Last session</th>
            <th scope="col" className={`${cell.th} text-right`}>Finished</th>
            <th scope="col" className={cell.th}>Joined</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.user_id} className="hover:bg-slate-50/70">
              <td className={cell.td}>
                <Link href={`/admin/students/${row.user_id}`} className="font-semibold text-slate-950 hover:text-brand-600 hover:underline">
                  {row.full_name.trim() || "Unnamed student"}
                </Link>
                <div className="text-[11.5px] text-slate-500">{row.email ?? "No email"}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.is_suspended ? <Badge tone="danger">Suspended</Badge> : null}
                  {!row.onboarding_completed ? <Badge tone="warning">Onboarding incomplete</Badge> : null}
                </div>
              </td>
              <td className={cell.td}>{row.exam_code ? `${row.exam_code.toUpperCase()} ${row.exam_year ?? ""}` : "—"}</td>
              <td className={cell.td}>
                <PlanBadge tier={row.plan_tier} />
                {row.master_expires_at ? <div className="mt-1 text-[11px] text-slate-500">until {formatDate(row.master_expires_at)}</div> : null}
              </td>
              <td className={`${cell.td} max-w-[240px] text-[11.5px]`}>{row.subject_names.length ? row.subject_names.join(", ") : "—"}</td>
              <td className={`${cell.td} whitespace-nowrap`}>{formatRelative(row.last_session_at)}</td>
              <td className={`${cell.td} ${cell.num}`}>{formatCount(row.finished_sessions)}</td>
              <td className={`${cell.td} whitespace-nowrap`}>{formatDate(row.joined_at)}</td>
            </tr>
          )) : <EmptyRow colSpan={7}>No students match these filters.</EmptyRow>}
        </tbody>
      </DataTable>
      <Pagination page={page} pageCount={pageCount} hrefFor={(next) => hrefWith("/admin/students", filters, { page: next })} />
      <p className="mt-3 text-[11.5px] text-slate-500">Last session is when the student most recently started a practice session or mock. Finished counts completed practice and submitted mocks.</p>
    </div>
  );
}
