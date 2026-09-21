import { notFound, redirect } from "next/navigation";

import { PracticeSessionRunner } from "@/components/practice/practice-session-runner";
import { AiAllowanceProvider } from "@/components/billing/ai-allowance";
import { getEntitlement } from "@/features/billing/entitlements";
import { getUsageSummary } from "@/features/billing/usage";
import { loadPracticeSessionForUser } from "@/features/practice/service";
import type { PracticeSessionView } from "@/features/practice/types";
import { toSessionOpenError } from "@/features/sessions/diagnostics";
import { requireOnboardedUser } from "@/lib/auth";
import { aiExplanationsEnabled } from "@/features/ai/config";

interface PracticeSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

type LoadedSession = {
  session: PracticeSessionView;
  aiEnabled: boolean;
  usage: Awaited<ReturnType<typeof getUsageSummary>> | null;
};

export default async function PracticeSessionPage({ params }: PracticeSessionPageProps) {
  const { user } = await requireOnboardedUser();
  const { sessionId } = await params;

  /*
   * Everything that can refuse this session is classified before it reaches the
   * route's error boundary, which renders one friendly paragraph and has no way
   * to say what went wrong. The student still sees that paragraph; what changes
   * is that the server now records which failure class it was.
   *
   * `notFound()` and `redirect()` are deliberately outside the try. Both work by
   * throwing a control-flow signal Next.js expects to catch itself, so running
   * them inside would turn a 404 or a redirect into a logged crash.
   */
  let loaded: LoadedSession | null = null;
  try {
    const entitlement = await getEntitlement(user.id).catch((error: unknown) => {
      throw toSessionOpenError(error, "practice", sessionId, "ENTITLEMENT_BLOCKED");
    });
    const session = await loadPracticeSessionForUser(user.id, sessionId);
    if (session) {
      const aiEnabled = aiExplanationsEnabled();
      loaded = {
        session,
        aiEnabled,
        usage: aiEnabled && !entitlement.isMaster ? await getUsageSummary(user.id) : null,
      };
    }
  } catch (error) {
    throw toSessionOpenError(error, "practice", sessionId);
  }

  if (!loaded) notFound();
  if (loaded.session.status === "completed") redirect(`/progress/results/practice/${sessionId}`);

  const { session, aiEnabled, usage } = loaded;
  return (
    <AiAllowanceProvider initial={usage ? { tier: usage.tier, meter: usage.aiExplanations } : null}>
      <PracticeSessionRunner initialSession={session} aiExplanationsEnabled={aiEnabled} />
    </AiAllowanceProvider>
  );
}
