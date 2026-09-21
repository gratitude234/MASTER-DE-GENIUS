import { NextResponse } from "next/server";
import { practiceLimitResponse } from "@/features/billing/api";
import { getEntitlement } from "@/features/billing/entitlements";
import { PracticeAllowanceExhausted, practiceMeterFor, readPracticeAllowance } from "@/features/billing/quota";
import { requireExamApiUser } from "@/features/exams/api";
import { startRevision } from "@/features/results/service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
export async function POST(request: Request) {
  const user = await requireExamApiUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  // Revision spends no provider quota, but it reads and re-grades the student's
  // whole history, so it is limited to protect the database.
  const limited = await enforceRateLimit(RATE_LIMITS.revisionCreate, user.id);
  if (limited) return limited;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object") throw new Error("Invalid revision request.");
    const x = input as Record<string, unknown>;
    if (typeof x.subjectSlug !== "string" || !/^[a-z0-9_-]{1,100}$/.test(x.subjectSlug)
      || (x.topicSlug !== undefined && (typeof x.topicSlug !== "string" || !/^[a-z0-9_-]{1,100}$/.test(x.topicSlug)))
      || (x.mistakes !== undefined && typeof x.mistakes !== "boolean")
      || (x.kind !== undefined && x.kind !== "exam" && x.kind !== "practice")
      || (x.resultId !== undefined && typeof x.resultId !== "string")) throw new Error("Invalid revision request.");
    // Re-practising saved questions is a new practice attempt, so on a
    // question-counted plan it draws on the same daily allowance as any other
    // practice. Reading the mistake bank and results never does.
    const meter = practiceMeterFor(await getEntitlement(user.id));
    try {
      const sessionId = await startRevision(user.id, { examBody: typeof x.examBody === "string" ? x.examBody : undefined, subjectSlug: x.subjectSlug, topicSlug: x.topicSlug as string | undefined,
        mistakes: x.mistakes as boolean | undefined, kind: x.kind as "exam" | "practice" | undefined, resultId: x.resultId as string | undefined }, meter);
      return NextResponse.json({ sessionId }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof PracticeAllowanceExhausted) {
        return practiceLimitResponse(error.meter, (await readPracticeAllowance(user.id, error.meter)) ?? undefined);
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start revision." }, { status: 400 });
  }
}
