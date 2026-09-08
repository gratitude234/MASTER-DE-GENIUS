import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The whole Paystack surface, in one server-only module.
 *
 * Paystack's REST API is small enough that a wrapper library would add a
 * dependency and an indirection without removing a single decision, so this
 * talks to it directly with `fetch`.
 *
 * Nothing here ever returns a provider payload to a caller that might serialise
 * it to the browser: each function narrows the response down to the few fields
 * the application actually needs to make a decision.
 */

const PAYSTACK_BASE_URL = "https://api.paystack.co";

export type PaystackEnvironment = "test" | "live";

export class PaystackError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaystackError";
  }
}

export function paystackSecretKey(): string {
  return process.env.PAYSTACK_SECRET_KEY?.trim() || "";
}

export function paystackPublicKey(): string {
  return process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY?.trim() || "";
}

/**
 * Which Paystack world this deployment is wired to, derived from the key
 * prefix rather than from a separate flag that could disagree with it.
 *
 * The verified transaction's `domain` is checked against this, so a live event
 * can never settle a transaction opened against test keys, or the reverse.
 */
export function paystackEnvironment(): PaystackEnvironment {
  return paystackSecretKey().startsWith("sk_live_") ? "live" : "test";
}

export function paystackConfigured(): boolean {
  const key = paystackSecretKey();
  return key.startsWith("sk_test_") || key.startsWith("sk_live_");
}

/**
 * The base URL used to build callback links.
 *
 * Deliberately configured rather than taken from the request `Host` header: a
 * forged host would otherwise send a paying student to somebody else's site
 * with their reference in the URL.
 */
export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return "http://localhost:3000";
  return configured.replace(/\/+$/, "");
}

/**
 * A reference that is unguessable as well as unique.
 *
 * It is the only identifier trusted to name a payment, so it is generated with
 * a CSPRNG. A sequential or timestamp-derived reference would let anyone
 * enumerate other students' transactions at the verification endpoint.
 */
export function generatePaymentReference(): string {
  return `mdg_${Date.now().toString(36)}_${randomBytes(16).toString("hex")}`;
}

/**
 * Verifies the `x-paystack-signature` header.
 *
 * HMAC SHA-512 over the exact bytes Paystack sent, keyed with the secret key.
 * The digest is compared in constant time so a response-timing oracle cannot be
 * used to discover a valid signature byte by byte. The caller must pass the raw
 * body: re-serialising parsed JSON changes key order and whitespace, and the
 * signature would never match again.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null | undefined): boolean {
  const secret = paystackSecretKey();
  if (!secret || typeof signature !== "string") return false;

  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  // timingSafeEqual throws on a length mismatch, so the cheap length check has
  // to come first — it leaks only the length of a hex digest, which is fixed.
  if (signature.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

async function paystackRequest<T>(path: string, init: RequestInit): Promise<T> {
  const secret = paystackSecretKey();
  if (!secret) throw new PaystackError("NOT_CONFIGURED", "Payments are not configured on this deployment.");

  let response: Response;
  try {
    response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The cause can carry the request URL and headers, so it never propagates.
    throw new PaystackError("NETWORK", "Could not reach the payment provider.");
  }

  let envelope: PaystackEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as PaystackEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || envelope?.status !== true || !envelope.data) {
    // Provider wording stays in the server log; the caller gets a code.
    console.error(`[paystack] ${path} failed with status ${response.status}`);
    throw new PaystackError("PROVIDER", "The payment provider rejected this request.");
  }

  return envelope.data;
}

export interface InitializeTransactionInput {
  email: string;
  /** Server-resolved, in kobo. Never taken from a request body. */
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  planSlug: string;
}

export interface InitializedTransaction {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/**
 * Opens a Paystack checkout.
 *
 * `metadata` is sent for the provider dashboard's benefit only. It is never
 * read back as an identity or an amount: Paystack echoes whatever it is given,
 * so trusting it to say who a payment belongs to would move authority into a
 * field outside this system's control. The local reference does that job.
 */
export async function initializePaystackTransaction(
  input: InitializeTransactionInput,
): Promise<InitializedTransaction> {
  const data = await paystackRequest<{
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      currency: "NGN",
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: { plan_slug: input.planSlug, product: "master_degenius" },
    }),
  });

  if (!data.authorization_url || !data.access_code) {
    throw new PaystackError("PROVIDER", "The payment provider did not return a checkout link.");
  }

  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference ?? input.reference,
  };
}

/** The narrowed view of a verified transaction. No card data, no authorization code. */
export interface VerifiedTransaction {
  reference: string;
  status: string;
  amountKobo: number;
  currency: string;
  environment: PaystackEnvironment;
  providerTransactionId: string | null;
  paidAt: string | null;
}

/**
 * Server-to-server verification.
 *
 * This is the authority on whether money moved. The webhook body is only ever a
 * trigger — even a correctly signed one — because verifying against Paystack's
 * own record is what makes a replayed or hand-crafted payload harmless.
 *
 * Everything except the seven fields below is dropped here, so an authorization
 * code or a card fingerprint cannot reach a log, a database row or a response.
 */
export async function verifyPaystackTransaction(reference: string): Promise<VerifiedTransaction> {
  const data = await paystackRequest<{
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    domain?: string;
    id?: number | string;
    paid_at?: string | null;
    paidAt?: string | null;
  }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });

  return {
    reference: typeof data.reference === "string" ? data.reference : "",
    status: typeof data.status === "string" ? data.status : "unknown",
    amountKobo: Number.isFinite(data.amount) ? Number(data.amount) : -1,
    currency: typeof data.currency === "string" ? data.currency : "",
    environment: data.domain === "live" ? "live" : "test",
    providerTransactionId: data.id == null ? null : String(data.id).slice(0, 64),
    paidAt: (typeof data.paid_at === "string" ? data.paid_at : null)
      ?? (typeof data.paidAt === "string" ? data.paidAt : null),
  };
}
