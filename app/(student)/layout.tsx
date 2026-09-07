import { DeviceOwner } from "@/components/pwa/device-owner";
import { StudentShell } from "@/components/app-shell/student-shell";
import { getStudentExamLabel } from "@/features/profile/queries";
import { requireOnboardedUser } from "@/lib/auth";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  // The client and user are already resolved here, so the sidebar's exam label
  // reuses them rather than re-authenticating for two columns.
  const { supabase, user } = await requireOnboardedUser();
  const examLabel = await getStudentExamLabel(supabase, user.id);

  return (
    <StudentShell examLabel={examLabel}>
      <DeviceOwner userId={user.id} />
      {children}
    </StudentShell>
  );
}
