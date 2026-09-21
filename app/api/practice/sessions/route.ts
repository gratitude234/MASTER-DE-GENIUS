import { resolveActiveExamContext } from "@/features/exam-context/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

import { practiceSessionLimitResponse } from "@/features/billing/api";
import { getEntitlement } from "@/features/billing/entitlements";
import { commitCapability, releaseCapability, reserveCapability } from "@/features/billing/quota";
import { getActivePracticeSessionForUser } from "@/features/practice/active-session";
import { practiceErrorResponse, requireApiUser } from "@/features/practice/api";
import { createPracticeSessionForUser } from "@/features/practice/service";
import { claimCreation, creationFingerprint, settleCreation } from "@/lib/creation-claim";
import { parseCreatePracticeSessionInput } from "@/features/practice/validation";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Creating a practice session — the one moment the daily practice allowance is
 * spent.
 *
 * The Free plan allows one new session a day, account-wide, of up to 20
 * questions. Every other thing a student can do with practice is free and stays
 * free: resuming, refreshing, closing the browser and coming back, answering,
 * finishing, viewing the result, reviewing answers, and the mistake bank. None
 * of them reach this route.
 *
 * Account-wide means exactly that. Past Questions is this endpoint with a year,
 * revision is `/api/progress/practice`, and both draw on the same day's
 * reservation — as do JAMB and WAEC, which are one student, not two.
 */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let input;
  try {
    input = parseCreatePracticeSessionInput(await request.json());
    const preference = await resolveActiveExamContext(createAdminClient(), user.id, input.examBody);
    input.examBody = preference.exam.code as "jamb" | "waec";
  } catch (error) {
    return practiceErrorResponse(error);
  }

  // Before the provider is contacted, so a rejected request costs no quota.
  const limited = await enforceRateLimit(RATE_LIMITS.practiceCreate, user.id);
  if (limited) return limited;

  /*
   * The size the browser asked for is never trusted. A Free student's session
   * is clamped to 20 here, on the server, before any question is fetched — so a
   * crafted `count: 40` simply builds the 20 the plan allows rather than being
   * refused or, worse, honoured.
   */
  const { limits } = await getEntitlement(user.id);
  const sized = { ...input, count: Math.min(input.count, limits.practice.maxQuestionsPerSession) };

  /*
   * The plan allowance is reserved, not spent. `reserve_product_quota` takes a
   * row lock on the student's window before it counts, so two tabs submitting
   * at the same instant serialise there and exactly one of them is allowed —
   * whichever serverless instance each landed on.
   *
   * It is only committed once a session genuinely exists, so a provider outage —
   * or a duplicate this request never created — hands the day back instead of
   * charging a student for nothing.
   *
   * This is the product limit, distinct from the abuse limiter above: that one
   * protects the question provider's credits and applies to every tier.
   */
  const reservation = await reserveCapability(user.id, "practice_session");
  if (!reservation.allowed) {
    /*
     * Today's session is already spent. Whether that is a dead end depends
     * entirely on whether it is still open: a student mid-way through a session
     * has lost nothing and must be sent back to it, not sold an upgrade.
     */
    return practiceSessionLimitResponse(reservation, await getActivePracticeSessionForUser(user.id));
  }

  const fingerprint = creationFingerprint([
    sized.examBody, sized.subjectSlug, sized.topicSlug, sized.count, sized.mode, sized.difficulty, sized.year,
  ]);

  const claim = await claimCreation(user.id, "practice", fingerprint);
  if (claim.status === "duplicate") {
    // A double-submit or retried POST. Hand back the session the first request
    // built rather than buying a second batch of questions — and give back the
    // allowance this request reserved, since it created nothing.
    await releaseCapability(reservation.reservationId);
    return NextResponse.json(
      { sessionId: claim.sessionId, questionCount: null, requestedCount: sized.count, deduplicated: true },
      { status: 200 },
    );
  }
  if (claim.status === "in_progress") {
    await releaseCapability(reservation.reservationId);
    return NextResponse.json(
      { error: "This session is already being prepared. Give it a moment.", code: "CREATION_IN_PROGRESS" },
      { status: 409, headers: { "Retry-After": "3" } },
    );
  }

  try {
    const result = await createPracticeSessionForUser(user.id, sized);
    await settleCreation(user.id, "practice", fingerprint, result.sessionId);
    await commitCapability(reservation.reservationId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    // Release immediately so a student who hit a provider error can retry at
    // once instead of waiting out the in-flight window — and so the failure
    // does not permanently consume a day's practice allowance.
    await settleCreation(user.id, "practice", fingerprint, null);
    await releaseCapability(reservation.reservationId);
    return practiceErrorResponse(error);
  }
}
