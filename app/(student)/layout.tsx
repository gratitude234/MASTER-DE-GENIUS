import { DeviceOwner } from "@/components/pwa/device-owner";
import { StudentShell } from "@/components/app-shell/student-shell";
import { requireOnboardedUser } from "@/lib/auth";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireOnboardedUser();
  return <StudentShell><DeviceOwner userId={user.id} />{children}</StudentShell>;
}
