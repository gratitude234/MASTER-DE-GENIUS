import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AdminPageHeader, Panel, Stat, StatGrid } from "@/components/admin/admin-ui";
import { InlineAlert } from "@/components/ui/inline-alert";
import { can, requireAdminPermission } from "@/features/admin/auth";
import { accuracy, formatCount, formatKobo, formatPercent, formatRelative } from "@/features/admin/format";
import { loadOverviewMetrics } from "@/features/admin/overview";
import type { SearchParams } from "@/features/admin/params";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [admin, params] = await Promise.all([requireAdminPermission("overview.view"), searchParams]);
  const metrics = await loadOverviewMetrics(admin.userId);
  const { students, exam_split: split, active_students: active, learning, monetisation, leads, support, questions, session_health: sessions, platform_health: health } = metrics;

  const attention = [
    leads && leads.waiting_over_24h > 0 && { count: leads.waiting_over_24h, label: "class leads waiting over 24 hours for first contact", href: "/admin/classes?status=new" },
    leads && leads.unassigned_open > 0 && { count: leads.unassigned_open, label: "open class leads with no owner", href: "/admin/classes?assignee=unassigned" },
    support && support.unassigned > 0 && { count: support.unassigned, label: "unresolved support cases with no owner", href: "/admin/support?assignee=unassigned" },
    sessions && sessions.overdue_mocks > 0 && { count: sessions.overdue_mocks, label: "mocks past their time but never submitted", href: "/admin/exams?kind=mock&state=overdue" },
    sessions && sessions.overdue_timed_practice > 0 && { count: sessions.overdue_timed_practice, label: "timed practice sessions past their time", href: "/admin/exams?kind=timed&state=overdue" },
    questions && questions.flagged > 0 && { count: questions.flagged, label: "internal questions flagged for review", href: "/admin/questions?status=flagged" },
    questions && questions.pending_review > 0 && { count: questions.pending_review, label: "internal questions pending review", href: "/admin/questions?status=pending_review" },
    health && health.provider_failures_24h > 0 && { count: health.provider_failures_24h, label: "failed question-provider requests in 24 hours", href: "/admin/system" },
    health && health.webhook_unfinished > 0 && { count: health.webhook_unfinished, label: "Paystack webhook deliveries left unfinished", href: "/admin/system#payments" },
    health && health.webhook_rejected_7d > 0 && { count: health.webhook_rejected_7d, label: "Paystack webhook deliveries rejected this week", href: "/admin/system#payments" },
    health && health.ai_failures_7d > 0 && { count: health.ai_failures_7d, label: "AI explanation failures this week", href: "/admin/system#ai" },
  ].filter((item): item is { count: number; label: string; href: string } => Boolean(item));

  const practiceAccuracy = learning ? accuracy(learning.practice_correct_30d, learning.practice_questions_30d) : null;

  return (
    <div className="space-y-5">
      <AdminPageHeader title="Overview" description="Live figures from the Master De Genius database. Periods are rolling, measured back from now." />

      {params.denied ? <InlineAlert tone="warning">Your role does not include that area. Ask a super admin if you need it.</InlineAlert> : null}

      <Panel title="Needs attention" description="Only items that currently need someone to act.">
        {attention.length ? (
          <ul className="divide-y divide-slate-100">
            {attention.map((item) => (
              <li key={item.href + item.label}>
                <Link href={item.href} className="flex items-center justify-between gap-3 py-2.5 text-[13px] text-slate-800 hover:text-slate-950">
                  <span><span className="mono-number mr-2 font-bold text-warning-800">{formatCount(item.count)}</span>{item.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-600">Nothing is waiting on an admin right now.</p>
        )}
      </Panel>

      {students ? (
        <section aria-labelledby="students-heading" className="space-y-2">
          <h2 id="students-heading" className="text-[13px] font-bold text-slate-950">Students</h2>
          <StatGrid className="xl:grid-cols-5">
            <Stat label="Registered" value={formatCount(students.total)} hint={`${formatCount(students.onboarded)} finished onboarding`} href="/admin/students" />
            <Stat label="New in 7 days" value={formatCount(students.new_7d)} hint={`${formatCount(students.new_30d)} in 30 days`} href="/admin/students?sort=joined_desc" />
            <Stat label="Active in 7 days" value={formatCount(active?.d7 ?? 0)} hint={`${formatCount(active?.d30 ?? 0)} in 30 days · started a session`} href="/admin/students?activity=active_7d" />
            <Stat label="JAMB students" value={formatCount(split?.jamb ?? 0)} hint="Primary exam" href="/admin/students?exam=jamb" />
            <Stat label="WAEC students" value={formatCount(split?.waec ?? 0)} hint="Primary exam" href="/admin/students?exam=waec" />
          </StatGrid>
        </section>
      ) : null}

      {learning ? (
        <section aria-labelledby="learning-heading" className="space-y-2">
          <h2 id="learning-heading" className="text-[13px] font-bold text-slate-950">Learning activity</h2>
          <StatGrid>
            <Stat label="Practice completed, 7 days" value={formatCount(learning.practice_completed_7d)} hint={`${formatCount(learning.practice_completed_30d)} in 30 days`} href="/admin/exams?state=finished" />
            <Stat label="Mocks submitted, 7 days" value={formatCount(learning.mocks_submitted_7d)} hint={`${formatCount(learning.mocks_submitted_30d)} in 30 days`} href="/admin/exams?kind=mock&state=finished" />
            <Stat label="Practice accuracy, 30 days" value={formatPercent(practiceAccuracy)} hint={`${formatCount(learning.practice_questions_30d)} questions · revision sets excluded`} href={can(admin, "academics.view") ? "/admin/academics" : undefined} />
          </StatGrid>
        </section>
      ) : null}

      {monetisation ? (
        <section aria-labelledby="money-heading" className="space-y-2">
          <h2 id="money-heading" className="text-[13px] font-bold text-slate-950">Monetisation</h2>
          <StatGrid className="xl:grid-cols-5">
            <Stat label="Active Master students" value={formatCount(monetisation.active_master)} hint="Paid or granted, not expired" />
            <Stat label="Revenue, 30 days" value={formatKobo(monetisation.revenue_30d_kobo)} hint={`${formatKobo(monetisation.revenue_7d_kobo)} in 7 days`} href="/admin/payments?status=success&environment=live" />
            <Stat label="Successful payments, 30 days" value={formatCount(monetisation.payments_30d)} hint={`${formatCount(monetisation.unsuccessful_30d)} failed or abandoned`} href="/admin/payments" />
            <Stat label="Revenue, all time" value={formatKobo(monetisation.revenue_all_kobo)} hint="Live Paystack payments only" />
            <Stat label="Manual grants, 30 days" value={formatCount(monetisation.manual_grants_30d)} hint={monetisation.test_payments_30d ? `${formatCount(monetisation.test_payments_30d)} test-mode payments excluded` : "Not counted as revenue"} />
          </StatGrid>
        </section>
      ) : null}

      {leads ? (
        <section aria-labelledby="leads-heading" className="space-y-2">
          <h2 id="leads-heading" className="text-[13px] font-bold text-slate-950">Premium Classes</h2>
          <StatGrid className="xl:grid-cols-5">
            <Stat label="New leads" value={formatCount(leads.new)} hint={`${formatCount(leads.created_7d)} created in 7 days`} href="/admin/classes?status=new" />
            <Stat label="Waiting over 24 hours" value={formatCount(leads.waiting_over_24h)} hint="Still marked New" href="/admin/classes?status=new" attention={leads.waiting_over_24h > 0} />
            <Stat label="Interested" value={formatCount(leads.interested)} href="/admin/classes?status=interested" />
            <Stat label="Follow up" value={formatCount(leads.follow_up)} href="/admin/classes?status=follow_up" />
            <Stat label="Enrolled" value={formatCount(leads.enrolled)} href="/admin/classes?status=enrolled" />
          </StatGrid>
        </section>
      ) : null}

      {support || questions ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {support ? (
            <section aria-labelledby="support-heading" className="space-y-2">
              <h2 id="support-heading" className="text-[13px] font-bold text-slate-950">Support</h2>
              <StatGrid className="sm:grid-cols-3 xl:grid-cols-3">
                <Stat label="Open" value={formatCount(support.open)} href="/admin/support?status=open" />
                <Stat label="In progress" value={formatCount(support.in_progress)} href="/admin/support?status=in_progress" />
                <Stat label="No owner" value={formatCount(support.unassigned)} href="/admin/support?assignee=unassigned" attention={support.unassigned > 0} />
              </StatGrid>
            </section>
          ) : null}
          {questions ? (
            <section aria-labelledby="questions-heading" className="space-y-2">
              <h2 id="questions-heading" className="text-[13px] font-bold text-slate-950">Question quality</h2>
              <StatGrid className="sm:grid-cols-3 xl:grid-cols-3">
                <Stat label="Active internal" value={formatCount(questions.active)} href="/admin/questions?status=active" />
                <Stat label="Flagged" value={formatCount(questions.flagged)} href="/admin/questions?status=flagged" attention={questions.flagged > 0} />
                <Stat label="Blocked external" value={formatCount(questions.blocked_external)} href="/admin/questions/external" />
              </StatGrid>
            </section>
          ) : null}
        </div>
      ) : null}

      {health ? (
        <section aria-labelledby="health-heading" className="space-y-2">
          <h2 id="health-heading" className="text-[13px] font-bold text-slate-950">Platform health</h2>
          <StatGrid>
            <Stat label="Provider requests, 24 hours" value={formatCount(health.provider_requests_24h)} hint={`${formatCount(health.provider_failures_24h)} failed · last success ${formatRelative(health.provider_last_ok_at)}`} href="/admin/system" attention={health.provider_failures_24h > 0} />
            <Stat label="AI explanations, 7 days" value={formatCount(health.ai_requests_7d)} hint={`${formatCount(health.ai_failures_7d)} failed`} href="/admin/system#ai" attention={health.ai_failures_7d > 0} />
            <Stat label="Webhooks rejected, 7 days" value={formatCount(health.webhook_rejected_7d)} href="/admin/system#payments" attention={health.webhook_rejected_7d > 0} />
            <Stat label="Unfinished webhooks" value={formatCount(health.webhook_unfinished)} hint="Lease expired, not yet retried" href="/admin/system#payments" attention={health.webhook_unfinished > 0} />
          </StatGrid>
          <p className="text-[11.5px] text-slate-500">Provider traffic is recorded for ALOC Station. Session saving failures on students&apos; devices are not reported to the server, so they cannot be counted here.</p>
        </section>
      ) : null}
    </div>
  );
}
