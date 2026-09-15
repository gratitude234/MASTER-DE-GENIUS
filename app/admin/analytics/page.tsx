import { AdminPageHeader, DataTable, Panel, Stat, StatGrid, cell } from "@/components/admin/admin-ui";
import { loadWeeklyAnalytics } from "@/features/admin/analytics";
import { requireAdminPermission } from "@/features/admin/auth";
import { accuracy, formatCount, formatKobo, formatPercent, formatShortDate } from "@/features/admin/format";
import { loadOverviewMetrics } from "@/features/admin/overview";
import { oneOf, textParam, type SearchParams } from "@/features/admin/params";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/variants";

export const dynamic = "force-dynamic";

const WEEK_CHOICES = ["8", "12", "26"] as const;

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("analytics.view"), searchParams]);
  const weeks = Number(oneOf(textParam(params, "weeks"), WEEK_CHOICES) ?? "8");
  const [rows, overview] = await Promise.all([loadWeeklyAnalytics(admin.userId, weeks), loadOverviewMetrics(admin.userId)]);
  const newestFirst = [...rows].reverse();
  const hasMoney = rows.some((row) => row.purchases !== undefined);
  const hasLeads = rows.some((row) => row.leadsCreated !== undefined);

  const students = overview.students;
  const split = overview.exam_split ?? {};
  const leads = overview.leads;
  const totalLeads = leads ? leads.new + leads.contacted + leads.interested + leads.follow_up + leads.enrolled + leads.not_interested + leads.closed : 0;
  const contactedEver = leads ? totalLeads - leads.new : 0;
  const totals = rows.reduce((sum, row) => ({
    registrations: sum.registrations + row.registrations,
    purchases: sum.purchases + (row.purchases ?? 0),
    firstPurchases: sum.firstPurchases + (row.firstPurchases ?? 0),
  }), { registrations: 0, purchases: 0, firstPurchases: 0 });

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Analytics"
        description="Weekly product figures from the database. Weeks start Monday (UTC); the current week is still in progress."
        actions={
          <div className="flex gap-1.5">
            {WEEK_CHOICES.map((value) => (
              <Link key={value} href={`/admin/analytics?weeks=${value}`} aria-current={Number(value) === weeks ? "true" : undefined} className={buttonClasses({ variant: Number(value) === weeks ? "dark" : "secondary", size: "sm" })}>{value} weeks</Link>
            ))}
          </div>
        }
      />

      <StatGrid>
        {students ? <Stat label="Onboarding completion" value={formatPercent(accuracy(students.onboarded, students.total))} hint={`${formatCount(students.onboarded)} of ${formatCount(students.total)} registered`} /> : null}
        {students ? <Stat label="JAMB / WAEC split" value={`${formatCount(split.jamb ?? 0)} / ${formatCount(split.waec ?? 0)}`} hint="By primary exam" /> : null}
        {hasMoney ? <Stat label={`Free → Master, ${weeks} weeks`} value={formatCount(totals.firstPurchases)} hint={`First purchases · ${formatPercent(accuracy(totals.firstPurchases, totals.registrations))} of registrations in the period`} /> : null}
        {leads ? <Stat label="Lead to enrolment" value={formatPercent(accuracy(leads.enrolled, totalLeads))} hint={`${formatCount(leads.enrolled)} enrolled of ${formatCount(totalLeads)} leads · ${formatCount(contactedEver)} past New`} /> : null}
      </StatGrid>

      <Panel title="Acquisition and engagement" bodyClassName="p-0">
        <DataTable label="Weekly acquisition and engagement" minWidth={980}>
          <thead>
            <tr>
              <th scope="col" className={cell.th}>Week of</th>
              <th scope="col" className={`${cell.th} text-right`}>Registrations</th>
              <th scope="col" className={`${cell.th} text-right`}>Onboarded</th>
              <th scope="col" className={`${cell.th} text-right`}>Active students</th>
              <th scope="col" className={`${cell.th} text-right`}>Practice completed</th>
              <th scope="col" className={`${cell.th} text-right`}>Mocks submitted</th>
              <th scope="col" className={`${cell.th} text-right`}>Revision sessions</th>
              <th scope="col" className={`${cell.th} text-right`}>AI generated</th>
              <th scope="col" className={`${cell.th} text-right`}>AI from cache</th>
              <th scope="col" className={`${cell.th} text-right`}>AI failed</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((row) => (
              <tr key={row.weekStart}>
                <td className={`${cell.td} whitespace-nowrap font-semibold text-slate-900`}>{formatShortDate(row.weekStart)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.registrations)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.onboarded)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.activeStudents)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.practiceCompleted)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.mocksSubmitted)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.revisionSessions)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.aiGenerated)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.aiCached)}</td>
                <td className={`${cell.td} ${cell.num}`}>{formatCount(row.aiFailed)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <p className="px-4 py-3 text-[11.5px] text-slate-500">Active students started at least one practice or mock that week. Revision sessions are started from results or the Mistake Bank; opening the Mistake Bank itself is not tracked.</p>
      </Panel>

      {hasMoney || hasLeads ? (
        <Panel title="Monetisation and Premium Classes" bodyClassName="p-0">
          <DataTable label="Weekly monetisation and classes" minWidth={760}>
            <thead>
              <tr>
                <th scope="col" className={cell.th}>Week of</th>
                {hasMoney ? <><th scope="col" className={`${cell.th} text-right`}>Purchases</th><th scope="col" className={`${cell.th} text-right`}>First purchases</th><th scope="col" className={`${cell.th} text-right`}>Revenue</th></> : null}
                {hasLeads ? <><th scope="col" className={`${cell.th} text-right`}>Class requests</th><th scope="col" className={`${cell.th} text-right`}>First contacted</th><th scope="col" className={`${cell.th} text-right`}>Enrolled</th></> : null}
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((row) => (
                <tr key={row.weekStart}>
                  <td className={`${cell.td} whitespace-nowrap font-semibold text-slate-900`}>{formatShortDate(row.weekStart)}</td>
                  {hasMoney ? <><td className={`${cell.td} ${cell.num}`}>{formatCount(row.purchases)}</td><td className={`${cell.td} ${cell.num}`}>{formatCount(row.firstPurchases)}</td><td className={`${cell.td} ${cell.num}`}>{formatKobo(row.revenueKobo)}</td></> : null}
                  {hasLeads ? <><td className={`${cell.td} ${cell.num}`}>{formatCount(row.leadsCreated)}</td><td className={`${cell.td} ${cell.num}`}>{formatCount(row.leadsContacted)}</td><td className={`${cell.td} ${cell.num}`}>{formatCount(row.leadsEnrolled)}</td></> : null}
                </tr>
              ))}
            </tbody>
          </DataTable>
          <p className="px-4 py-3 text-[11.5px] text-slate-500">Purchases and revenue count live-mode successful Paystack payments. A first purchase is a student&apos;s first ever successful payment. Manual grants are not purchases.</p>
        </Panel>
      ) : null}
    </div>
  );
}
