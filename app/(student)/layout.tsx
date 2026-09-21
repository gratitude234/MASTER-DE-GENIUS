import { getStudentExamPreferences, resolveActiveExamContext } from "@/features/exam-context/service";
import { ExamSwitcher } from "@/components/app-shell/exam-switcher";
import { DeviceOwner } from "@/components/pwa/device-owner";
import { StudentShell } from "@/components/app-shell/student-shell";
import { getPlanBadge } from "@/features/billing/usage";
import { requireOnboardedUser } from "@/lib/auth";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  // The client and user are already resolved here, so the sidebar's exam label
  // reuses them rather than re-authenticating for two columns.
  const { supabase, user } = await requireOnboardedUser();
  const [preferences, active, plan] = await Promise.all([
    getStudentExamPreferences(supabase, user.id),
    resolveActiveExamContext(supabase, user.id),
    // Tier only, from the server-side entitlement: enough to choose between the
    // "Upgrade to Master" prompt and the Master badge.
    getPlanBadge(user.id),
  ]);
  const examLabel = { shortName: active.exam.short_name, year: active.exam_year };

  return (
    <StudentShell examLabel={examLabel} plan={plan}>
      <DeviceOwner userId={user.id} />
      <ExamSwitcher active={active.exam.code} options={preferences.map(preference => ({ code: preference.exam.code, label: `${preference.exam.short_name} ${preference.exam_year}` }))} />
      {children}
    </StudentShell>
  );
}
