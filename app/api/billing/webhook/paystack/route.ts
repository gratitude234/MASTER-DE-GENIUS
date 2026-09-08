import { NextResponse } from "next/server";

import { paystackConfigured, paystackEnvironment, verifyPaystackSignature } from "@/features/billing/paystack";
import { liveWebhookDeps, processPaystackEvent } from "@/features/billing/webhook";

export const runtime = "nodejs";
// Paystack posts here directly; there is no session and nothing to cache.
export const dynamic = "force-dynamic";

/**
 * The Paystack webhook.
 *
 * Order matters and is deliberate: the raw bytes are read first, the signature
 * is checked against those exact bytes, and only then is anything parsed. JSON
 * parsing an unauthenticated body would run a parser on attacker input for no
 * reason, and re-serialising a parsed body to check the signature would change
 * key order and whitespace so the HMAC could never match again.
 *
 * A rejected signature produces a 401 with no detail. Telling an unauthenticated
 * caller *why* their signature failed is a free oracle.
 */
export async function POST(request: Request) {
  if (!paystackConfigured()) {
    // Nothing can be verified without the secret, so nothing is acted on. 200
    // keeps a misconfigured deployment from accumulating provider retries.
    console.error("[billing] webhook received while Paystack is not configured");
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifyPaystackSignature(rawBody, signature)) {
    console.error("[billing] webhook signature rejected");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await processPaystackEvent(payload, liveWebhookDeps(paystackEnvironment()));

    /*
     * Three answers, because Paystack redelivers anything non-2xx.
     *
     * `retry` — nothing was decided and the claim was released, so the next
     * delivery must run. A dependency of ours was down, which is a 503.
     *
     * `rejected` — decided, and permanently refused: a mismatched amount, a
     * wrong currency, the wrong environment. Answering non-2xx surfaces it as a
     * failed delivery in the Paystack dashboard, which is exactly where an
     * operator should see a payment that did not add up. The claim is terminal,
     * so the redelivery is dismissed as a duplicate rather than reprocessed.
     *
     * Everything else is acknowledged, which is what stops a permanent
     * condition — an unknown event, an unrecognised reference — becoming a
     * permanent retry loop.
     */
    if (result.outcome === "retry") {
      return NextResponse.json({ received: false, status: result.detail }, { status: 503 });
    }
    if (result.outcome === "rejected") {
      return NextResponse.json({ received: true, status: result.detail }, { status: 400 });
    }

    return NextResponse.json({ received: true, status: result.outcome }, { status: 200 });
  } catch {
    console.error("[billing] webhook processing failed");
    // A 500 asks Paystack to retry, which is the right answer to an unexpected
    // fault: the event has not been applied, and it should not be lost.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
