import { MockExamSetup } from "@/components/exam/mock-exam-setup";
import { loadMockExamSetupForUser } from "@/features/exams/service";
import { requireOnboardedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MockPage() {
  const { user } = await requireOnboardedUser();
  const setup = await loadMockExamSetupForUser(user.id);
  return <MockExamSetup setup={setup} />;
}
