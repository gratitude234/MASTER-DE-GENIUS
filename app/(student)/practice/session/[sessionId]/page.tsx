import { notFound, redirect } from "next/navigation";

import { PracticeSessionRunner } from "@/components/practice/practice-session-runner";
import { loadPracticeSessionForUser } from "@/features/practice/service";
import { requireOnboardedUser } from "@/lib/auth";

interface PracticeSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function PracticeSessionPage({ params }: PracticeSessionPageProps) {
  const { user } = await requireOnboardedUser();
  const { sessionId } = await params;
  const session = await loadPracticeSessionForUser(user.id, sessionId);

  if (!session) notFound();

  if (session.status === "completed") redirect(`/progress/results/practice/${sessionId}`);
  return <PracticeSessionRunner initialSession={session} />;
}
