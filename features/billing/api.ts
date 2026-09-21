import "server-only";

import { NextResponse } from "next/server";

import { planLimitNotice, planLimitText, type LimitedCapability } from "@/features/billing/limit-notice";
import type { PracticeMeter, PracticeQuestionAllowance, QuotaReservation } from "@/features/billing/quota";

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
): NextResponse {
  const notice = planLimitNotice({
    capability,
    tier: reservation.tier,
    limit: reservation.limit,
    resetAt: reservation.window.resetAt,
    windowKind: reservation.window.kind,
  });

  return NextResponse.json(
    { ...extra, error: planLimitText(notice), code: notice.code, limit: notice },
    { status: 402, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * The Free practice-question allowance, refused. `allowance` is included when
 * known so the browser can redraw the counts without a second request.
 */
export function practiceLimitResponse(meter: PracticeMeter, allowance?: PracticeQuestionAllowance): NextResponse {
  return planLimitResponse(
    "practice_question",
    { tier: meter.tier, limit: meter.limit, window: { key: meter.dayKey, kind: "day", resetAt: meter.resetAt } },
    allowance ? { allowance } : {},
  );
}
