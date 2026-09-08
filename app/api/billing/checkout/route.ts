import { NextResponse } from "next/server";

import {
  assertPaystackConfigured,
  BillingError,
  liveCheckoutDeps,
  parseCheckoutRequest,
  startCheckout,
} from "@/features/billing/checkout";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" } as const;

/**
 * Opens a Paystack checkout for the authenticated student.
 *
 * The request body may contain exactly one meaningful field — `planSlug`. Price,
 * currency and duration are resolved from the server catalogue and again from
 * `billing_plans` inside the database function, so an amount posted by the
 * browser has nowhere to be read.
 *
 * The email is read from the Supabase session rather than the body: sending
 * Paystack a caller-supplied address would let one student pay onto another
 * student's receipt, and would make the provider's record disagree with ours.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401, headers: noStore });
  }

  try {
    assertPaystackConfigured();
  } catch (error) {
    const billing = error as BillingError;
    return NextResponse.json({ error: billing.message, code: billing.code }, { status: billing.status, headers: noStore });
  }

  // Distributed and PostgreSQL-backed, like every other limiter here — a rapid
  // sequence of taps must cost the same whichever instance answers it.
  const limited = await enforceRateLimit(RATE_LIMITS.billingCheckout, user.id);
  if (limited) return limited;

  try {
    const { planSlug } = parseCheckoutRequest(await request.json().catch(() => null));

    const result = await startCheckout(
      { userId: user.id, email: user.email ?? "", planSlug },
      liveCheckoutDeps(),
    );

    // Only what the browser needs to send the student to Paystack. No secret,
    // no access code, no provider response.
    return NextResponse.json(
      {
        authorizationUrl: result.authorizationUrl,
        reference: result.reference,
        planSlug: result.planSlug,
        planName: result.planName,
        amountKobo: result.amountKobo,
        currency: result.currency,
        accessDays: result.accessDays,
        reused: result.reused,
      },
      { status: 200, headers: noStore },
    );
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore });
    }
    console.error("[billing] checkout failed unexpectedly");
    return NextResponse.json(
      { error: "Payments are temporarily unavailable. Please try again shortly.", code: "CHECKOUT_FAILED" },
      { status: 503, headers: noStore },
    );
  }
}
