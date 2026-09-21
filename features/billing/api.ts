import "server-only";

import { NextResponse } from "next/server";

import { planLimitNotice, planLimitText, type LimitedCapability } from "@/features/billing/limit-notice";
import type { ActivePracticeSession } from "@/features/billing/usage-types";
import type { QuotaReservation } from "@/features/billing/quota";

/**
 * The one shape a plan limit takes on the wire.
 *
 * 402 rather than 429: the student is not going too fast, they have used what
 * their plan includes. Keeping them distinct matters because the browser reacts
 * differently — a 429 says "wait", a 402 says "here is what upgrading changes".
 *
 * The body carries the student-facing copy and a link, never a bare
 * "quota exceeded". `error` repeats the full sentence so a caller that only
 * knows how to render `error` still shows something useful.
 */
export function planLimitResponse(
  capability: LimitedCapability,
  reservation: Pick<QuotaReservation, "tier" | "limit" | "window">,
  extra: Record<string, unknown> = {},
  /** The practice session the student may resume instead. See planLimitNotice. */
  resumeSessionId: string | null = null,
): NextResponse {
  const notice = planLimitNotice({
    capability,
    tier: reservation.tier,
    limit: reservation.limit,
    resetAt: reservation.window.resetAt,
    windowKind: reservation.window.kind,
    resumeSessionId,
  });

  return NextResponse.json(
    { ...extra, error: planLimitText(notice), code: notice.code, limit: notice },
    { status: 402, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * A new practice session was refused because today's allowance is spent.
 *
 * `activeSession` is the session the student already has open, when there is
 * one. Included in the body so the browser can offer Resume without a second
 * request — the difference between "come back tomorrow" and "you are already
 * in it".
 */
export function practiceSessionLimitResponse(
  reservation: Pick<QuotaReservation, "tier" | "limit" | "window">,
  activeSession: ActivePracticeSession | null,
): NextResponse {
  return planLimitResponse(
    "practice_session",
    reservation,
    activeSession ? { activeSession } : {},
    activeSession?.id ?? null,
  );
}
