import { NextResponse } from "next/server";

import { BillingError } from "@/features/billing/checkout";
import { reconcilePayment } from "@/features/billing/reconcile";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" } as const;

/**
 * Re-checks one payment for the authenticated student.
 *
 * The callback page polls this while a payment is still settling. It accepts a
 * reference and nothing else: no user id, no amount, no duration and no plan,
 * because every one of those is already recorded against the reference on the
 * server. A reference belonging to another account resolves to `unknown`, the
 * same answer an invented one gets, so this cannot be used to probe which
 * references exist.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers: noStore });
  }

  const limited = await enforceRateLimit(RATE_LIMITS.billingVerify, user.id);
  if (limited) return limited;

  try {
    const body = (await request.json().catch(() => null)) as { reference?: unknown } | null;
    const result = await reconcilePayment(user.id, body?.reference);
    return NextResponse.json(result, { status: 200, headers: noStore });
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
    }
    console.error("[billing] verification failed unexpectedly");
    return NextResponse.json(
      { error: "We could not check this payment. Please try again shortly.", code: "VERIFY_FAILED" },
      { status: 503, headers: noStore },
    );
  }
}
