import { redirect } from "next/navigation";
import { MockExamSetup } from "@/components/exam/mock-exam-setup";
import { loadMockExamSetupForUser } from "@/features/exams/service";
import { getStudentProfile } from "@/features/profile/queries";

export const dynamic = "force-dynamic";

export default async function MockPage() {
  const { user, examBody } = await getStudentProfile();
  if (examBody?.code === "waec") redirect("/practice?timed=1");
  const setup = await loadMockExamSetupForUser(user.id);
  return <MockExamSetup setup={setup} />;
}
