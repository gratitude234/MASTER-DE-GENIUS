import { notFound, redirect } from "next/navigation";

import { ExamAttemptRunner } from "@/components/exam/exam-attempt-runner";
import { loadExamAttemptForUser } from "@/features/exams/service";
import { requireOnboardedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const { user } = await requireOnboardedUser();
  const attempt = await loadExamAttemptForUser(user.id, attemptId);
  if (!attempt) notFound();
  if (attempt.status === "submitted") redirect(`/progress/results/exam/${attemptId}`);
  return <ExamAttemptRunner initialAttempt={attempt} />;
}
