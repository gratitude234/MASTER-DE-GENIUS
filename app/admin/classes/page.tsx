import Link from "next/link";
import { AdminPageHeader, DataTable, EmptyRow, Field, FilterBar, Pagination, ResultCount, cell } from "@/components/admin/admin-ui";
import { SearchField } from "@/components/admin/search-field";
import { LeadStatusBadge } from "@/components/admin/status-badges";
import { Select } from "@/components/ui/select";
import { fieldClasses } from "@/components/ui/variants";
import { requireAdminPermission } from "@/features/admin/auth";
import { displayName, loadAssignees } from "@/features/admin/directory";
import { formatCount, formatDateTime, humanize } from "@/features/admin/format";
import { dateParam, hrefWith, pageParam, textParam, type SearchParams } from "@/features/admin/params";
import { countLeadsByStatus, listAdminLeads, loadClassCatalogue } from "@/features/classes/service";
import { ADMIN_STATUS_LABELS, CLASS_LEAD_STATUSES, CLASS_TYPE_LABELS } from "@/features/classes/types";
import { leadReference } from "@/features/classes/whatsapp";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminClassesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("classes.view"), searchParams]);
  const filters = {
    status: textParam(params, "status"),
    exam: textParam(params, "exam"),
    subject: textParam(params, "subject"),
    classType: textParam(params, "classType"),
    assignee: textParam(params, "assignee"),
    search: textParam(params, "search"),
    from: dateParam(params, "from"),
    to: dateParam(params, "to"),
  };
  const page = pageParam(params);

  const [{ leads, total, pageCount }, totals, subjects, assignees] = await Promise.all([
    listAdminLeads(filters, page),
    countLeadsByStatus(),
    loadClassCatalogue(),
    loadAssignees(admin.userId, "classes.manage"),
  ]);
  const owners = new Map(assignees.map((entry) => [entry.userId, displayName(entry)]));

  return (
    <div>
      <AdminPageHeader title="Master Classes" description="Every Premium Class request, from first contact through enrolment." />

      <nav aria-label="Lead status" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {CLASS_LEAD_STATUSES.map((status) => {
          const active = filters.status === status;
          return (
            <Link
              key={status}
              href={hrefWith("/admin/classes", { ...filters, status: undefined }, { status: active ? undefined : status })}
              aria-current={active ? "true" : undefined}
              className={cn("rounded-xl border bg-white px-3 py-2.5", active ? "border-slate-950 ring-1 ring-slate-950" : "border-slate-200 hover:border-slate-300")}
            >
              <span className="block text-[10.5px] font-semibold text-slate-500">{ADMIN_STATUS_LABELS[status]}</span>
              <span className="mono-number block text-lg font-semibold text-slate-950">{formatCount(totals[status])}</span>
            </Link>
          );
        })}
      </nav>

      <FilterBar action="/admin/classes" resetHref="/admin/classes">
        <Field label="Search" className="sm:col-span-2">
          <SearchField label="Search leads" defaultValue={filters.search} placeholder="Name, email or phone" />
        </Field>
        <Field label="Status">
          <Select name="status" size="md" defaultValue={filters.status ?? ""}>
            <option value="">All statuses</option>
            {CLASS_LEAD_STATUSES.map((value) => <option key={value} value={value}>{ADMIN_STATUS_LABELS[value]}</option>)}
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
            {subjects.map((subject) => <option key={subject.id} value={subject.slug}>{subject.name}</option>)}
          </Select>
        </Field>
        <Field label="Class type">
          <Select name="classType" size="md" defaultValue={filters.classType ?? ""}>
            <option value="">All types</option>
            {Object.entries(CLASS_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Owner">
          <Select name="assignee" size="md" defaultValue={filters.assignee ?? ""}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {assignees.map((entry) => <option key={entry.userId} value={entry.userId}>{entry.userId === admin.userId ? "Me" : displayName(entry)}</option>)}
          </Select>
        </Field>
        <Field label="Created from">
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
        <Field label="Created to">
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
      </FilterBar>

      <ResultCount total={total} shown={leads.length} noun="lead" />
      <DataTable label="Class leads" minWidth={1040}>
        <thead>
          <tr>
            <th scope="col" className={cell.th}>Student</th>
            <th scope="col" className={cell.th}>Request</th>
            <th scope="col" className={cell.th}>Contact</th>
            <th scope="col" className={cell.th}>Source</th>
            <th scope="col" className={cell.th}>Status</th>
            <th scope="col" className={cell.th}>Owner</th>
            <th scope="col" className={cell.th}>Created</th>
          </tr>
        </thead>
        <tbody>
          {leads.length ? leads.map((lead) => (
            <tr key={lead.id} className="hover:bg-slate-50/70">
              <td className={cell.td}>
                <Link href={`/admin/classes/${lead.id}`} className="font-semibold text-slate-950 hover:text-brand-600 hover:underline">{lead.student_name}</Link>
                <div className="mono-number text-[11px] text-slate-500">Ref {leadReference(lead.id)}</div>
              </td>
              <td className={cell.td}>
                {lead.exam_type.toUpperCase()} · {lead.subject_name}{lead.topic ? ` · ${lead.topic}` : ""}
                <div className="text-[11px] text-slate-500">{CLASS_TYPE_LABELS[lead.class_type]}</div>
              </td>
              <td className={cell.td}>
                <span className="mono-number">{lead.phone}</span>
                <div className="text-[11px] text-slate-500">Prefers {lead.preferred_contact_method}</div>
              </td>
              <td className={`${cell.td} text-[11.5px]`}>
                {humanize(lead.source)}
                <div className="text-slate-500">{humanize(lead.recommendation_reason)}</div>
              </td>
              <td className={cell.td}><LeadStatusBadge status={lead.status} /></td>
              <td className={`${cell.td} text-[11.5px]`}>{lead.assigned_to ? owners.get(lead.assigned_to) ?? "Former admin" : <span className="text-slate-400">Unassigned</span>}</td>
              <td className={`${cell.td} whitespace-nowrap`}>{formatDateTime(lead.created_at)}</td>
            </tr>
          )) : <EmptyRow colSpan={7}>No leads match these filters.</EmptyRow>}
        </tbody>
      </DataTable>
      <Pagination page={page} pageCount={pageCount} hrefFor={(next) => hrefWith("/admin/classes", filters, { page: next })} />
    </div>
  );
}
