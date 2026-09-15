import Link from "next/link";
import { AdminPageHeader, DataTable, EmptyRow, Field, FilterBar, Pagination, ResultCount, cell } from "@/components/admin/admin-ui";
import { SearchField } from "@/components/admin/search-field";
import { Select } from "@/components/ui/select";
import { fieldClasses } from "@/components/ui/variants";
import { AUDIT_ENTITY_TYPES, auditActionLabel, listAuditLog } from "@/features/admin/audit";
import { requireAdminPermission } from "@/features/admin/auth";
import { formatDateTime, humanize } from "@/features/admin/format";
import { dateParam, endOfDayWat, hrefWith, oneOf, pageParam, startOfDayWat, textParam, type SearchParams } from "@/features/admin/params";
import { ADMIN_ROLE_LABELS } from "@/features/admin/permissions";

export const dynamic = "force-dynamic";

const ENTITY_LINKS: Partial<Record<string, (id: string) => string>> = {
  student: (id) => `/admin/students/${id}`,
  question: (id) => `/admin/questions/${id}`,
  class_lead: (id) => `/admin/classes/${id}`,
  support_case: (id) => `/admin/support/${id}`,
  exam_attempt: (id) => `/admin/exams/exam/${id}`,
  practice_session: (id) => `/admin/exams/practice/${id}`,
};

function StateBlock({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500">{label}</p>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 text-[11px] leading-4 text-slate-800">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default async function AdminAuditLogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("audit.view"), searchParams]);
  const filters = {
    entityType: oneOf(textParam(params, "entityType"), AUDIT_ENTITY_TYPES),
    entityId: textParam(params, "entityId", 200),
    actor: textParam(params, "actor"),
    from: dateParam(params, "from"),
    to: dateParam(params, "to"),
  };
  const page = pageParam(params);
  const { rows, total, pageCount } = await listAuditLog(admin.userId, {
    ...filters,
    from: filters.from ? startOfDayWat(filters.from) : undefined,
    to: filters.to ? endOfDayWat(filters.to) : undefined,
  }, page);

  return (
    <div>
      <AdminPageHeader title="Audit Log" description="Every sensitive administrative action, with who did it, why, and what changed. Entries cannot be edited or deleted." />

      <FilterBar action="/admin/audit-log" resetHref="/admin/audit-log">
        <Field label="Admin" className="sm:col-span-2">
          <SearchField name="actor" label="Search by admin" defaultValue={filters.actor} placeholder="Admin name or email" />
        </Field>
        <Field label="Record type">
          <Select name="entityType" size="md" defaultValue={filters.entityType ?? ""}>
            <option value="">All records</option>
            {AUDIT_ENTITY_TYPES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
          </Select>
        </Field>
        <Field label="Record ID">
          <input name="entityId" defaultValue={filters.entityId ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
        <Field label="From">
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={fieldClasses({ size: "md" })} />
        </Field>
      </FilterBar>

      <ResultCount total={total} shown={rows.length} noun="entry" />
      <DataTable label="Audit log" minWidth={980}>
        <thead>
          <tr>
            <th scope="col" className={cell.th}>When</th>
            <th scope="col" className={cell.th}>Admin</th>
            <th scope="col" className={cell.th}>Action</th>
            <th scope="col" className={cell.th}>Record</th>
            <th scope="col" className={cell.th}>Reason and change</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => {
            const link = ENTITY_LINKS[row.entity_type]?.(row.entity_id);
            return (
              <tr key={row.id}>
                <td className={`${cell.td} whitespace-nowrap`}>{formatDateTime(row.created_at)}</td>
                <td className={cell.td}>{row.actorName}<div className="text-[11px] text-slate-500">{row.actor_role ? ADMIN_ROLE_LABELS[row.actor_role] : ""}</div></td>
                <td className={`${cell.td} font-semibold text-slate-950`}>{auditActionLabel(row.action)}<div className="mono-number text-[10.5px] font-normal text-slate-500">{row.action}</div></td>
                <td className={`${cell.td} text-[11.5px]`}>
                  {humanize(row.entity_type)}
                  <div>{link ? <Link href={link} className="mono-number break-all text-brand-600 hover:underline">{row.entityName ?? row.entity_id}</Link> : <span className="mono-number break-all">{row.entityName ?? row.entity_id}</span>}</div>
                </td>
                <td className={`${cell.td} max-w-[380px]`}>
                  {row.reason ? <p className="text-[12px] text-slate-800">“{row.reason}”</p> : null}
                  {row.before_state || row.after_state ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11.5px] font-semibold text-brand-600">Before and after</summary>
                      <div className="mt-2 grid gap-2">
                        <StateBlock label="Before" value={row.before_state} />
                        <StateBlock label="After" value={row.after_state} />
                      </div>
                    </details>
                  ) : null}
                </td>
              </tr>
            );
          }) : <EmptyRow colSpan={5}>No audit entries match these filters.</EmptyRow>}
        </tbody>
      </DataTable>
      <Pagination page={page} pageCount={pageCount} hrefFor={(next) => hrefWith("/admin/audit-log", filters, { page: next })} />
    </div>
  );
}
