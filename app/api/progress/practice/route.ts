import { NextResponse } from "next/server";
import { practiceSessionLimitResponse } from "@/features/billing/api";
import { getEntitlement } from "@/features/billing/entitlements";
import { commitCapability, releaseCapability, reserveCapability } from "@/features/billing/quota";
import { requireExamApiUser } from "@/features/exams/api";
import { getActivePracticeSessionForUser } from "@/features/practice/active-session";
import { startRevision } from "@/features/results/service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Practising from a result or the mistake bank.
 *
 * A revision set is a real new practice session, so it spends the day's
 * practice allowance like any other — the allowance is account-wide, and a
 * second entry point into practice must not be a second allowance. Reading the
 * result or the mistake bank that produced it costs nothing and never reaches
 * this route.
 */
export async function POST(request: Request) {
  const user = await requireExamApiUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  // Revision spends no provider quota, but it reads and re-grades the student's
  // whole history, so it is limited to protect the database.
  const limited = await enforceRateLimit(RATE_LIMITS.revisionCreate, user.id);
  if (limited) return limited;

  let input: {
    examBody?: string; subjectSlug: string; topicSlug?: string;
    mistakes?: boolean; kind?: "exam" | "practice"; resultId?: string;
  };
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new Error("Invalid revision request.");
    const x = body as Record<string, unknown>;
    if (typeof x.subjectSlug !== "string" || !/^[a-z0-9_-]{1,100}$/.test(x.subjectSlug)
      || (x.topicSlug !== undefined && (typeof x.topicSlug !== "string" || !/^[a-z0-9_-]{1,100}$/.test(x.topicSlug)))
      || (x.mistakes !== undefined && typeof x.mistakes !== "boolean")
      || (x.kind !== undefined && x.kind !== "exam" && x.kind !== "practice")
      || (x.resultId !== undefined && typeof x.resultId !== "string")) throw new Error("Invalid revision request.");
    input = {
      examBody: typeof x.examBody === "string" ? x.examBody : undefined,
      subjectSlug: x.subjectSlug,
      topicSlug: x.topicSlug as string | undefined,
      mistakes: x.mistakes as boolean | undefined,
      kind: x.kind as "exam" | "practice" | undefined,
      resultId: x.resultId as string | undefined,
    };
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start revision." }, { status: 400 });
  }

  const { limits } = await getEntitlement(user.id);

  // Reserved under the same per-student window lock Practice uses, so a tab on
  // Practice and a tab on the mistake bank cannot both take today's session.
  const reservation = await reserveCapability(user.id, "practice_session");
  if (!reservation.allowed) {
    return practiceSessionLimitResponse(reservation, await getActivePracticeSessionForUser(user.id));
  }

  try {
    const sessionId = await startRevision(user.id, input, limits.practice.maxQuestionsPerSession);
    await commitCapability(reservation.reservationId);
    return NextResponse.json({ sessionId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Nothing was created — no subject, no matching mistakes, a database
    // failure. The day's session goes straight back.
    await releaseCapability(reservation.reservationId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start revision." }, { status: 400 });
  }
}
