import Link from "next/link";
import { AdminPageHeader, DataTable, EmptyRow, Field, FilterBar, Pagination, ResultCount, cell } from "@/components/admin/admin-ui";
import { SearchField } from "@/components/admin/search-field";
import { SupportStatusBadge } from "@/components/admin/status-badges";
import { SupportCaseDialog } from "@/components/admin/support-case-dialog";
import { Select } from "@/components/ui/select";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { displayName, loadAssignees } from "@/features/admin/directory";
import { formatDateTime, formatRelative, humanize } from "@/features/admin/format";
import { hrefWith, oneOf, pageParam, textParam, type SearchParams } from "@/features/admin/params";
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, SUPPORT_STATUSES, SUPPORT_STATUS_LABELS, listSupportCases } from "@/features/admin/support";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("support.view"), searchParams]);
  const assignee = textParam(params, "assignee", 36);
  const filters = {
    status: oneOf(textParam(params, "status"), SUPPORT_STATUSES),
    category: oneOf(textParam(params, "category"), SUPPORT_CATEGORIES),
    assignee: assignee === "unassigned" || (assignee && UUID.test(assignee)) ? assignee : undefined,
    search: textParam(params, "search"),
  };
  const page = pageParam(params);
  const [{ rows, total, pageCount }, assignees] = await Promise.all([
    listSupportCases(admin.userId, filters, page),
    loadAssignees(admin.userId, "support.manage"),
  ]);
  const assigneeOptions = assignees.map((entry) => ({ userId: entry.userId, label: entry.userId === admin.userId ? `${displayName(entry)} (me)` : displayName(entry) }));

  return (
    <div>
      <AdminPageHeader
        title="Support"
        description="Students still reach support through Need Help? and WhatsApp. Log each issue here so it has an owner and a resolution."
        actions={can(admin, "support.manage") ? <SupportCaseDialog assignees={assigneeOptions} triggerVariant="dark" /> : undefined}
      />

      <FilterBar action="/admin/support" resetHref="/admin/support">
        <Field label="Search" className="sm:col-span-2">
          <SearchField label="Search support cases" defaultValue={filters.search} placeholder="Summary, student name or email" />
        </Field>
        <Field label="Status">
          <Select name="status" size="md" defaultValue={filters.status ?? ""}>
            <option value="">All statuses</option>
            {SUPPORT_STATUSES.map((value) => <option key={value} value={value}>{SUPPORT_STATUS_LABELS[value]}</option>)}
          </Select>
        </Field>
        <Field label="Category">
          <Select name="category" size="md" defaultValue={filters.category ?? ""}>
            <option value="">All categories</option>
            {SUPPORT_CATEGORIES.map((value) => <option key={value} value={value}>{SUPPORT_CATEGORY_LABELS[value]}</option>)}
          </Select>
        </Field>
        <Field label="Owner">
          <Select name="assignee" size="md" defaultValue={filters.assignee ?? ""}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {assigneeOptions.map((entry) => <option key={entry.userId} value={entry.userId}>{entry.label}</option>)}
          </Select>
        </Field>
      </FilterBar>

      <ResultCount total={total} shown={rows.length} noun="case" />
      <DataTable label="Support cases" minWidth={900}>
        <thead>
          <tr>
            <th scope="col" className={cell.th}>Case</th>
            <th scope="col" className={cell.th}>Student</th>
            <th scope="col" className={cell.th}>Category</th>
            <th scope="col" className={cell.th}>Status</th>
            <th scope="col" className={cell.th}>Owner</th>
            <th scope="col" className={cell.th}>Opened</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50/70">
              <td className={`${cell.td} max-w-[320px]`}>
                <Link href={`/admin/support/${row.id}`} className="font-semibold text-slate-950 hover:text-brand-600 hover:underline">{row.subject}</Link>
                <div className="text-[11px] text-slate-500">via {humanize(row.channel)}</div>
              </td>
              <td className={cell.td}>{row.student ? displayName(row.student) : <span className="text-slate-400">Not linked</span>}<div className="text-[11px] text-slate-500">{row.student?.email ?? ""}</div></td>
              <td className={cell.td}>{SUPPORT_CATEGORY_LABELS[row.category]}</td>
              <td className={cell.td}><SupportStatusBadge status={row.status} /></td>
              <td className={`${cell.td} text-[11.5px]`}>{row.assignee ? displayName(row.assignee) : <span className="text-slate-400">Unassigned</span>}</td>
              <td className={`${cell.td} whitespace-nowrap`}>{formatRelative(row.created_at)}<div className="text-[11px] text-slate-500">{formatDateTime(row.created_at)}</div></td>
            </tr>
          )) : <EmptyRow colSpan={6}>No support cases match these filters.</EmptyRow>}
        </tbody>
      </DataTable>
      <Pagination page={page} pageCount={pageCount} hrefFor={(next) => hrefWith("/admin/support", filters, { page: next })} />
    </div>
  );
}
