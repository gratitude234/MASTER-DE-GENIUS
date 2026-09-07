import { NextResponse } from "next/server";

import { practiceErrorResponse, requireApiUser } from "@/features/practice/api";
import { createPracticeSessionForUser } from "@/features/practice/service";
import { parseCreatePracticeSessionInput } from "@/features/practice/validation";
import { claimCreation, creationFingerprint, settleCreation } from "@/lib/creation-claim";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let input;
  try {
    input = parseCreatePracticeSessionInput(await request.json());
  } catch (error) {
    return practiceErrorResponse(error);
  }

  // Before the provider is contacted, so a rejected request costs no quota.
  const limited = await enforceRateLimit(RATE_LIMITS.practiceCreate, user.id);
  if (limited) return limited;

  const fingerprint = creationFingerprint([
    input.subjectSlug, input.topicSlug, input.count, input.mode, input.difficulty, input.year,
  ]);

  const claim = await claimCreation(user.id, "practice", fingerprint);
  if (claim.status === "duplicate") {
    // A double-submit or retried POST. Hand back the session the first request
    // built rather than buying a second batch of questions.
    return NextResponse.json(
      { sessionId: claim.sessionId, questionCount: null, requestedCount: input.count, deduplicated: true },
      { status: 200 },
    );
  }
  if (claim.status === "in_progress") {
    return NextResponse.json(
      { error: "This session is already being prepared. Give it a moment.", code: "CREATION_IN_PROGRESS" },
      { status: 409, headers: { "Retry-After": "3" } },
    );
  }

  try {
    const result = await createPracticeSessionForUser(user.id, input);
    await settleCreation(user.id, "practice", fingerprint, result.sessionId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    // Release immediately so a student who hit a provider error can retry at
    // once instead of waiting out the in-flight window.
    await settleCreation(user.id, "practice", fingerprint, null);
    return practiceErrorResponse(error);
  }
}
