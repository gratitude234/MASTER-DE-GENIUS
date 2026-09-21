import { notFound, redirect } from "next/navigation";

import { PracticeSessionRunner } from "@/components/practice/practice-session-runner";
import { AiAllowanceProvider } from "@/components/billing/ai-allowance";
import { getEntitlement } from "@/features/billing/entitlements";
import { practiceMeterFor } from "@/features/billing/quota";
import { getUsageSummary } from "@/features/billing/usage";
import { loadPracticeSessionForUser } from "@/features/practice/service";
import { requireOnboardedUser } from "@/lib/auth";
import { aiExplanationsEnabled } from "@/features/ai/config";

interface PracticeSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function PracticeSessionPage({ params }: PracticeSessionPageProps) {
  const { user } = await requireOnboardedUser();
  const { sessionId } = await params;
  const entitlement = await getEntitlement(user.id);
  const session = await loadPracticeSessionForUser(user.id, sessionId, practiceMeterFor(entitlement));

  if (!session) notFound();

  if (session.status === "completed") redirect(`/progress/results/practice/${sessionId}`);
  const aiEnabled = aiExplanationsEnabled();
  const usage = aiEnabled && !entitlement.isMaster ? await getUsageSummary(user.id) : null;
  return (
    <AiAllowanceProvider initial={usage ? { tier: usage.tier, meter: usage.aiExplanations } : null}>
      <PracticeSessionRunner initialSession={session} aiExplanationsEnabled={aiEnabled} />
    </AiAllowanceProvider>
  );
}
