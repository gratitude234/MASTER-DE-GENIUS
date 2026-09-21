import { redirect } from "next/navigation";
import { MockExamSetup } from "@/components/exam/mock-exam-setup";
import { getUsageSummary } from "@/features/billing/usage";
import { loadMockExamSetupForUser } from "@/features/exams/service";
import { getStudentProfile } from "@/features/profile/queries";

export const dynamic = "force-dynamic";

export default async function MockPage() {
  const { user, examBody } = await getStudentProfile();
  if (examBody?.code === "waec") redirect("/practice?timed=1");
  const [setup, usage] = await Promise.all([loadMockExamSetupForUser(user.id), getUsageSummary(user.id)]);
  return <MockExamSetup setup={setup} mockAllowance={usage.isMaster ? null : usage.mocks} />;
}
