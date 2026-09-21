import { resolveActiveExamContext } from "@/features/exam-context/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

import { planLimitResponse, practiceLimitResponse } from "@/features/billing/api";
import { getEntitlement } from "@/features/billing/entitlements";
import {
  commitCapability,
  PracticeAllowanceExhausted,
  practiceMeterFor,
  readPracticeAllowance,
  releaseCapability,
  reserveCapability,
  type PracticeMeter,
} from "@/features/billing/quota";
import { practiceErrorResponse, requireApiUser } from "@/features/practice/api";
import { createPracticeSessionForUser } from "@/features/practice/service";
import type { CreatePracticeSessionInput } from "@/features/practice/types";
import { parseCreatePracticeSessionInput } from "@/features/practice/validation";
import { claimCreation, creationFingerprint, settleCreation } from "@/lib/creation-claim";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

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

  // A plan that counts practice questions (Free) takes the metered path. Every
  // entry point that builds a practice paper — this one, Past Questions (the
  // same endpoint with a year) and revision — shares the one ledger.
  const meter = practiceMeterFor(await getEntitlement(user.id));
  if (meter) return createMeteredSession(user.id, input, meter);

  /*
   * The plan allowance is reserved, not spent. It is only committed once a
   * session genuinely exists, so a provider outage — or a duplicate this
   * request never created — hands the allowance straight back instead of
   * charging a student for nothing.
   *
   * This is the product limit, distinct from the abuse limiter above: that one
   * protects the question provider's credits and applies to every tier.
   */
  const reservation = await reserveCapability(user.id, "practice_session");
  if (!reservation.allowed) return planLimitResponse("practice_session", reservation);

  const fingerprint = creationFingerprint([
    input.examBody, input.subjectSlug, input.topicSlug, input.count, input.mode, input.difficulty, input.year,
  ]);

  const claim = await claimCreation(user.id, "practice", fingerprint);
  if (claim.status === "duplicate") {
    // A double-submit or retried POST. Hand back the session the first request
    // built rather than buying a second batch of questions — and give back the
    // allowance this request reserved, since it created nothing.
    await releaseCapability(reservation.reservationId);
    return NextResponse.json(
      { sessionId: claim.sessionId, questionCount: null, requestedCount: input.count, deduplicated: true },
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
    const result = await createPracticeSessionForUser(user.id, input);
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

/**
 * A practice session on a question-counted plan.
 *
 * The paper is never larger than what the student may still start: the request
 * is sized down to the allowance before the provider is asked for anything, so
 * questions beyond it are never fetched, never frozen and never sent. The size
 * the browser asked for is not trusted — a manipulated count is simply clamped.
 *
 * The read here only sizes the request. The authoritative check runs again in
 * `create_metered_practice_session` under the ledger lock, so two tabs racing
 * for the last questions cannot both get them.
 */
async function createMeteredSession(userId: string, input: CreatePracticeSessionInput, meter: PracticeMeter) {
  const allowance = await readPracticeAllowance(userId, meter);
  if (!allowance) {
    return NextResponse.json(
      { error: "Practice is unavailable right now. Please try again shortly.", code: "ALLOWANCE_UNAVAILABLE" },
      { status: 503, headers: { "Retry-After": "10" } },
    );
  }
  if (allowance.available < 1 && allowance.remaining > 0) {
    // Nothing is used up: what is left is already waiting in a session the
    // student has not finished. Saying "you've used today's questions" would be
    // false, so this says where they are instead.
    return NextResponse.json(
      {
        error: "Your remaining free practice questions are waiting in a session you haven’t finished. Continue it to use them.",
        code: "PRACTICE_QUESTIONS_WAITING",
        allowance,
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (allowance.available < 1) return practiceLimitResponse(meter, allowance);

  const sized: CreatePracticeSessionInput = { ...input, count: Math.min(input.count, allowance.available) };
  const fingerprint = creationFingerprint([
    sized.examBody, sized.subjectSlug, sized.topicSlug, sized.count, sized.mode, sized.difficulty, sized.year,
  ]);

  const claim = await claimCreation(userId, "practice", fingerprint);
  if (claim.status === "duplicate") {
    // The first request's session already holds its questions; a retry must
    // neither build nor hold a second paper.
    return NextResponse.json(
      { sessionId: claim.sessionId, questionCount: null, requestedCount: sized.count, deduplicated: true },
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
    const result = await createPracticeSessionForUser(userId, sized, meter);
    await settleCreation(userId, "practice", fingerprint, result.sessionId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    await settleCreation(userId, "practice", fingerprint, null);
    if (error instanceof PracticeAllowanceExhausted) {
      // Lost a race for the last questions. Nothing was created or held.
      return practiceLimitResponse(meter, (await readPracticeAllowance(userId, meter)) ?? undefined);
    }
    return practiceErrorResponse(error);
  }
}
