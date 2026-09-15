import Link from "next/link";
import { AdminPageHeader, DataTable, EmptyRow, Field, FilterBar, Pagination, Panel, ResultCount, Stat, StatGrid, cell } from "@/components/admin/admin-ui";
import { SearchField } from "@/components/admin/search-field";
import { PaymentStatusBadge } from "@/components/admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { fieldClasses } from "@/components/ui/variants";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { displayName } from "@/features/admin/directory";
import { formatCount, formatDate, formatDateTime, formatKobo, humanize } from "@/features/admin/format";
import { loadOverviewMetrics } from "@/features/admin/overview";
import { dateParam, endOfDayWat, hrefWith, oneOf, pageParam, startOfDayWat, textParam, type SearchParams } from "@/features/admin/params";
import { PAYMENT_ENVIRONMENTS, PAYMENT_PLAN_SLUGS, PAYMENT_STATUSES, listManualGrants, listPayments } from "@/features/admin/payments";
import { findPlan } from "@/features/billing/plans";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("payments.view"), searchParams]);
  const query = {
    status: oneOf(textParam(params, "status"), PAYMENT_STATUSES),
    environment: oneOf(textParam(params, "environment"), PAYMENT_ENVIRONMENTS),
    plan: oneOf(textParam(params, "plan"), PAYMENT_PLAN_SLUGS),
    search: textParam(params, "search"),
    from: dateParam(params, "from"),
    to: dateParam(params, "to"),
  };
  const page = pageParam(params);

  const [{ rows, total, pageCount }, overview, grants] = await Promise.all([
    listPayments(admin.userId, { ...query, from: query.from && startOfDayWat(query.from), to: query.to && endOfDayWat(query.to) }, page),
    loadOverviewMetrics(admin.userId),
    listManualGrants(admin.userId),
  ]);
  const money = overview.monetisation;

  return (
    <div className="space-y-5">
      <AdminPageHeader title="Payments" description="The Paystack ledger, read-only. Amounts are stored in kobo and shown in naira. Revenue counts live-mode successful payments only." />

      {money ? (
        <StatGrid className="xl:grid-cols-5">
          <Stat label="Revenue, 30 days" value={formatKobo(money.revenue_30d_kobo)} hint={`${formatKobo(money.revenue_7d_kobo)} in 7 days`} />
          <Stat label="Revenue, all time" value={formatKobo(money.revenue_all_kobo)} />
          <Stat label="Successful payments, 30 days" value={formatCount(money.payments_30d)} />
          <Stat label="Active Master students" value={formatCount(money.active_master)} hint="Includes manual grants" />
          <Stat label="Failed or abandoned, 30 days" value={formatCount(money.unsuccessful_30d)} />
        </StatGrid>
      ) : null}

      <div>
        <FilterBar action="/admin/payments" resetHref="/admin/payments">
          <Field label="Search" className="sm:col-span-2">
            <SearchField label="Search payments" defaultValue={query.search} placeholder="Reference, student name or email" />
          </Field>
          <Field label="Status">
            <Select name="status" size="md" defaultValue={query.status ?? ""}>
              <option value="">All statuses</option>
              {PAYMENT_STATUSES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
            </Select>
          </Field>
          <Field label="Mode">
            <Select name="environment" size="md" defaultValue={query.environment ?? ""}>
              <option value="">Live and test</option>
              <option value="live">Live</option>
              <option value="test">Test</option>
            </Select>
          </Field>
          <Field label="Plan">
            <Select name="plan" size="md" defaultValue={query.plan ?? ""}>
              <option value="">All plans</option>
              {PAYMENT_PLAN_SLUGS.map((slug) => <option key={slug} value={slug}>{findPlan(slug)?.name ?? slug}</option>)}
            </Select>
          </Field>
          <Field label="Created from">
            <input type="date" name="from" defaultValue={query.from ?? ""} className={fieldClasses({ size: "md" })} />
          </Field>
          <Field label="Created to">
            <input type="date" name="to" defaultValue={query.to ?? ""} className={fieldClasses({ size: "md" })} />
          </Field>
        </FilterBar>

        <ResultCount total={total} shown={rows.length} noun="transaction" />
        <DataTable label="Payment transactions" minWidth={1080}>
          <thead>
            <tr>
              <th scope="col" className={cell.th}>Reference</th>
              <th scope="col" className={cell.th}>Student</th>
              <th scope="col" className={cell.th}>Plan</th>
              <th scope="col" className={`${cell.th} text-right`}>Amount</th>
              <th scope="col" className={cell.th}>Status</th>
              <th scope="col" className={cell.th}>Paid</th>
              <th scope="col" className={cell.th}>Access granted until</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/70">
                <td className={cell.td}>
                  <span className="mono-number break-all text-[11.5px] text-slate-900">{row.reference}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.environment === "test" ? <Badge tone="warning">Test mode</Badge> : null}
                  </div>
                  <div className="text-[11px] text-slate-500">Opened {formatDateTime(row.created_at)}</div>
                </td>
                <td className={cell.td}>
                  {can(admin, "students.view") ? (
                    <Link href={`/admin/students/${row.user_id}`} className="font-semibold text-slate-950 hover:underline">{displayName(row.student)}</Link>
                  ) : <span className="font-semibold text-slate-950">{displayName(row.student)}</span>}
                  <div className="text-[11px] text-slate-500">{row.student?.email ?? ""}</div>
                </td>
                <td className={cell.td}>{findPlan(row.plan_slug)?.name ?? row.plan_slug}<div className="text-[11px] text-slate-500">{row.access_days} days</div></td>
                <td className={`${cell.td} ${cell.num} font-semibold text-slate-950`}>{formatKobo(row.amount_kobo)}</td>
                <td className={cell.td}>
                  <PaymentStatusBadge status={row.status} />
                  {row.failure_reason ? <div className="mt-1 text-[11px] text-slate-500">{humanize(row.failure_reason)}</div> : null}
                </td>
                <td className={`${cell.td} whitespace-nowrap`}>{formatDateTime(row.paid_at)}</td>
                <td className={`${cell.td} whitespace-nowrap`}>{row.status === "success" ? formatDate(row.entitlement_expires_at) : "—"}</td>
              </tr>
            )) : <EmptyRow colSpan={7}>No transactions match these filters.</EmptyRow>}
          </tbody>
        </DataTable>
        <Pagination page={page} pageCount={pageCount} hrefFor={(next) => hrefWith("/admin/payments", query, { page: next })} />
      </div>

      <Panel title="Manual Master grants" description="Access given by an admin. No money changed hands, so these never appear in the ledger or revenue." bodyClassName="p-0">
        <DataTable label="Manual grants" minWidth={820}>
          <thead>
            <tr>
              <th scope="col" className={cell.th}>Student</th>
              <th scope="col" className={cell.th}>Change</th>
              <th scope="col" className={cell.th}>New expiry</th>
              <th scope="col" className={cell.th}>By</th>
              <th scope="col" className={cell.th}>Reason</th>
              <th scope="col" className={cell.th}>When</th>
            </tr>
          </thead>
          <tbody>
            {grants.length ? grants.map((grant) => (
              <tr key={grant.id}>
                <td className={cell.td}>{can(admin, "students.view") ? <Link href={`/admin/students/${grant.userId}`} className="font-semibold hover:underline">{grant.student}</Link> : grant.student}</td>
                <td className={cell.td}>{humanize(grant.eventType)}</td>
                <td className={`${cell.td} whitespace-nowrap`}>{formatDate(grant.newExpiresAt)}</td>
                <td className={cell.td}>{grant.actor}</td>
                <td className={`${cell.td} max-w-[280px] text-[11.5px]`}>{grant.reason ?? "—"}</td>
                <td className={`${cell.td} whitespace-nowrap`}>{formatDateTime(grant.createdAt)}</td>
              </tr>
            )) : <EmptyRow colSpan={6}>No manual grants yet.</EmptyRow>}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  );
}
