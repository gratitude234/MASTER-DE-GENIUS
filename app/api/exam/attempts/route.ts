import { NextResponse } from "next/server";

import { planLimitResponse } from "@/features/billing/api";
import { commitCapability, releaseCapability, reserveCapability } from "@/features/billing/quota";
import { examErrorResponse, requireExamApiUser } from "@/features/exams/api";
import { createMockExamAttemptForUser } from "@/features/exams/service";
import { claimCreation, creationFingerprint, settleCreation } from "@/lib/creation-claim";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST() {
  const user = await requireExamApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A mock is the most expensive thing the product buys — roughly six upstream
  // requests — so it is limited before any of them can be sent.
  const limited = await enforceRateLimit(RATE_LIMITS.mockCreate, user.id);
  if (limited) return limited;

  /*
   * The plan allowance: one full mock a month on Free, three a day on Master.
   * Reserved before the paper is built and only committed once a *new* attempt
   * exists, so resuming an attempt already in progress costs nothing.
   */
  const reservation = await reserveCapability(user.id, "mock_attempt");
  if (!reservation.allowed) return planLimitResponse("mock_attempt", reservation);

  /*
   * The existing one-active-attempt index still does the real work: it makes a
   * duplicate attempt impossible, and the service resumes rather than rebuilds.
   * But that index is only reached after all four subjects have been fetched, so
   * two concurrent submits would spend two full papers' worth of quota before
   * one of them lost. The claim closes that window; it does not replace the index.
   */
  const fingerprint = creationFingerprint(["full_mock"]);
  const claim = await claimCreation(user.id, "exam", fingerprint);

  if (claim.status === "duplicate") {
    await releaseCapability(reservation.reservationId);
    return NextResponse.json(
      { attemptId: claim.sessionId, resumed: true, totalQuestions: null, deduplicated: true },
      { status: 200 },
    );
  }
  if (claim.status === "in_progress") {
    await releaseCapability(reservation.reservationId);
    return NextResponse.json(
      { error: "Your paper is already being built. Give it a moment.", code: "CREATION_IN_PROGRESS" },
      { status: 409, headers: { "Retry-After": "5" } },
    );
  }

  try {
    const result = await createMockExamAttemptForUser(user.id);
    await settleCreation(user.id, "exam", fingerprint, result.attemptId);
    // Returning to a paper already in progress is not a new mock attempt, so
    // it must not spend the month's — or the day's — allowance.
    if (result.resumed) await releaseCapability(reservation.reservationId);
    else await commitCapability(reservation.reservationId);
    return NextResponse.json(result, { status: result.resumed ? 200 : 201 });
  } catch (error) {
    await settleCreation(user.id, "exam", fingerprint, null);
    await releaseCapability(reservation.reservationId);
    return examErrorResponse(error);
  }
}
