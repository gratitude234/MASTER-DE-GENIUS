import "server-only";

import {
  verifyPaystackTransaction,
  type PaystackEnvironment,
  type VerifiedTransaction,
} from "@/features/billing/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Paystack event processing.
 *
 * Two rules shape everything below.
 *
 * First: a signature proves the message came from Paystack, not that money
 * moved. Even a perfectly signed `charge.success` is treated as a hint to go
 * and ask Paystack's own API what actually happened, so a replayed or
 * hand-crafted body — including one built by someone who obtained the secret's
 * signature some other way — still cannot activate access on its own.
 *
 * Second: the local reference is the only identity. Provider metadata is echoed
 * back from whatever was sent at initialization, so resolving a payment through
 * it would put the answer to "whose account does this credit?" outside this
 * system's control.
 *
 * The amount, currency and environment checks run twice — here, and again
 * inside `apply_successful_payment` under the payment row's lock. The
 * application layer gives a precise reason for the log; the database layer is
 * what makes the guarantee.
 */

/** Events this release knows how to act on. Everything else is acknowledged and ignored. */
const SUPPORTED_EVENTS = new Set([
  "charge.success",
  "charge.failed",
  "transfer.failed",
  "refund.processed",
  "refund.failed",
  "charge.dispute.create",
]);

/**
 * `retry` is deliberately separate from `rejected`.
 *
 * `rejected` is a decision — this delivery will never be accepted, and the
 * claim on it is permanent. `retry` means nothing was decided: a dependency was
 * briefly unavailable, so the claim is released and Paystack's next delivery of
 * the same event must be allowed to run. Collapsing the two would turn one
 * transient outage into a payment that never activates.
 */
export type WebhookOutcome = "applied" | "ignored" | "duplicate" | "rejected" | "retry";

/** The outcomes that are terminal, and therefore safe to record permanently. */
export type TerminalWebhookOutcome = Exclude<WebhookOutcome, "retry">;

export interface WebhookResult {
  outcome: WebhookOutcome;
  /** Short, sanitized, and safe to store. Never a provider payload. */
  detail: string;
}

export interface ApplyPaymentResult {
  outcome: string;
  userId: string | null;
  expiresAt: string | null;
}

export interface WebhookDeps {
  verifyTransaction(reference: string): Promise<VerifiedTransaction>;
  recordEvent(input: {
    eventId: string;
    eventType: string;
    reference: string | null;
  }): Promise<{
    isNew: boolean;
    eventRowId: number | null;
    /** The gate itself could not be consulted. Nothing was claimed. */
    unavailable?: boolean;
  }>;
  finishEvent(eventRowId: number | null, outcome: TerminalWebhookOutcome, detail: string): Promise<void>;
  /** Hands the claim back so Paystack's retry of this event can run. */
  releaseEvent(eventRowId: number | null, detail: string): Promise<void>;
  applyPayment(input: {
    reference: string;
    amountKobo: number;
    currency: string;
    environment: PaystackEnvironment;
    providerTransactionId: string | null;
    paidAt: string | null;
    providerStatus: string;
  }): Promise<ApplyPaymentResult>;
  markUnsuccessful(input: {
    reference: string;
    status: "failed" | "abandoned" | "reversed";
    reason: string;
    providerStatus: string | null;
  }): Promise<void>;
  environment: PaystackEnvironment;
}

interface ParsedEvent {
  event: string;
  reference: string | null;
  /** Paystack's own event/transaction id, used only for idempotency. */
  eventId: string;
}

/**
 * Pulls the three fields worth trusting out of an arbitrary body.
 *
 * Everything else — customer records, authorization objects, card metadata — is
 * dropped here so it cannot reach a log line or a database column further down.
 */
export function parsePaystackEvent(payload: unknown): ParsedEvent | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.event !== "string" || !record.event) return null;

  const data = (record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const reference = typeof data.reference === "string" && data.reference.length > 0 ? data.reference : null;
  const rawId = data.id ?? record.id;
  // Falling back to the reference keeps redelivery idempotent even when a
  // payload carries no numeric id of its own.
  const eventId = rawId == null ? `${record.event}:${reference ?? "unknown"}` : `${record.event}:${String(rawId)}`;

  return { event: record.event, reference, eventId: eventId.slice(0, 200) };
}

/**
 * Runs one event to a decision.
 *
 * Returns rather than throws for every expected refusal: Paystack retries a
 * non-2xx delivery, and a body that will never succeed — an unknown event, a
 * reference this deployment has no record of — should be acknowledged once, not
 * redelivered indefinitely.
 */
export async function processPaystackEvent(payload: unknown, deps: WebhookDeps): Promise<WebhookResult> {
  const parsed = parsePaystackEvent(payload);
  if (!parsed) return { outcome: "rejected", detail: "unparsable_event" };

  const recorded = await deps.recordEvent({
    eventId: parsed.eventId,
    eventType: parsed.event,
    reference: parsed.reference,
  });

  /*
   * The gate could not be consulted at all, so nothing was claimed and nothing
   * has run. Asking for a retry is the only safe answer: treating it as a
   * duplicate would acknowledge a delivery that was never processed, and
   * Paystack would never send it again.
   */
  if (recorded.unavailable) {
    return { outcome: "retry", detail: "idempotency_unavailable" };
  }

  // Paystack retries. A delivery already decided by any instance stops here,
  // before anything can be applied a second time.
  if (!recorded.isNew) {
    return { outcome: "duplicate", detail: "already_processed" };
  }

  /** Records a terminal decision. This delivery will never run again. */
  const finish = async (result: WebhookResult & { outcome: TerminalWebhookOutcome }): Promise<WebhookResult> => {
    await deps.finishEvent(recorded.eventRowId, result.outcome, result.detail);
    return result;
  };

  /**
   * Nothing was decided. The claim goes back so the next delivery of this same
   * event is processed rather than dismissed as a duplicate.
   */
  const retry = async (detail: string): Promise<WebhookResult> => {
    await deps.releaseEvent(recorded.eventRowId, detail);
    return { outcome: "retry", detail };
  };

  if (!SUPPORTED_EVENTS.has(parsed.event)) {
    return finish({ outcome: "ignored", detail: "unsupported_event" });
  }
  if (!parsed.reference) {
    return finish({ outcome: "ignored", detail: "no_reference" });
  }

  /*
   * Refunds, reversals and disputes are recorded and left for a human.
   *
   * Paystack's contract for these is not verified end to end here, and the
   * failure modes are asymmetric: wrongly revoking access cuts off a student
   * who paid, mid-preparation, while a delayed manual revocation costs one
   * subscription. The conservative side is the one that does not strand a
   * student, so nothing below ever removes access that was granted.
   */
  if (parsed.event === "refund.processed" || parsed.event === "refund.failed" || parsed.event === "charge.dispute.create") {
    return finish({ outcome: "ignored", detail: `${parsed.event}_recorded_for_manual_review` });
  }

  if (parsed.event !== "charge.success") {
    await deps.markUnsuccessful({
      reference: parsed.reference,
      status: "failed",
      reason: parsed.event,
      providerStatus: parsed.event,
    });
    return finish({ outcome: "ignored", detail: "non_success_event" });
  }

  // The body said "success". Paystack's API is asked whether that is true.
  let verified: VerifiedTransaction;
  try {
    verified = await deps.verifyTransaction(parsed.reference);
  } catch {
    // Paystack's own API is unreachable, so whether money moved is simply not
    // known yet. The claim is released rather than finished: a payment must not
    // be lost because verification was down for one delivery.
    return retry("verification_unavailable");
  }

  if (verified.reference !== parsed.reference) {
    return finish({ outcome: "rejected", detail: "reference_mismatch" });
  }
  if (verified.status !== "success") {
    await deps.markUnsuccessful({
      reference: parsed.reference,
      status: verified.status === "abandoned" ? "abandoned" : "failed",
      reason: `verified_status_${verified.status}`.slice(0, 60),
      providerStatus: verified.status,
    });
    return finish({ outcome: "ignored", detail: "not_successful_upstream" });
  }
  if (verified.currency !== "NGN") {
    return finish({ outcome: "rejected", detail: "currency_not_ngn" });
  }
  if (verified.environment !== deps.environment) {
    return finish({ outcome: "rejected", detail: "environment_mismatch" });
  }

  const applied = await deps.applyPayment({
    reference: parsed.reference,
    amountKobo: verified.amountKobo,
    currency: verified.currency,
    environment: verified.environment,
    providerTransactionId: verified.providerTransactionId,
    paidAt: verified.paidAt,
    providerStatus: verified.status,
  });

  switch (applied.outcome) {
    case "applied":
      return finish({ outcome: "applied", detail: "entitlement_granted" });
    case "already_applied":
      // The browser callback reconciled it first. Not an error, and explicitly
      // not a second grant.
      return finish({ outcome: "duplicate", detail: "entitlement_already_granted" });
    case "not_found":
      return finish({ outcome: "ignored", detail: "unknown_reference" });
    case "apply_failed":
      // The grant itself could not be attempted — our database, not the
      // payment. Verification already said this transaction is good, so the
      // delivery must stay retryable.
      return retry("apply_unavailable");
    default:
      // amount_mismatch, currency_mismatch, environment_mismatch, not_pending:
      // all decided, and all permanent.
      return finish({ outcome: "rejected", detail: applied.outcome.slice(0, 60) });
  }
}

interface ApplyRow {
  outcome: string;
  user_id: string | null;
  expires_at: string | null;
}

interface RecordEventRow {
  is_new: boolean;
  event_row_id: number | null;
}

/** The production wiring. */
export function liveWebhookDeps(environment: PaystackEnvironment): WebhookDeps {
  const admin = createAdminClient();

  return {
    environment,
    verifyTransaction: verifyPaystackTransaction,

    async recordEvent(input) {
      const { data, error } = await admin.rpc("record_billing_webhook_event", {
        p_provider: "paystack",
        p_event_id: input.eventId,
        p_event_type: input.eventType,
        p_reference: input.reference,
      });
      if (error) {
        // Nothing was claimed, so nothing has run. The caller must ask Paystack
        // to deliver again rather than acknowledge an event it never processed.
        console.error(`[billing] webhook event record failed: ${error.code ?? "unknown"}`);
        return { isNew: false, eventRowId: null, unavailable: true };
      }
      const row = (data as unknown as RecordEventRow[])?.[0];
      return { isNew: Boolean(row?.is_new), eventRowId: row?.event_row_id ?? null };
    },

    async finishEvent(eventRowId, outcome, detail) {
      if (eventRowId == null) return;
      const { error } = await admin.rpc("finish_billing_webhook_event", {
        p_event_row_id: eventRowId,
        p_outcome: outcome,
        p_detail: detail,
      });
      if (error) console.error(`[billing] webhook event finish failed: ${error.code ?? "unknown"}`);
    },

    async releaseEvent(eventRowId, detail) {
      if (eventRowId == null) return;
      const { error } = await admin.rpc("release_billing_webhook_event", {
        p_event_row_id: eventRowId,
        p_detail: detail,
      });
      // The claim also lapses on its own lease, so a failure here delays the
      // retry rather than losing it.
      if (error) console.error(`[billing] webhook event release failed: ${error.code ?? "unknown"}`);
    },

    async applyPayment(input) {
      const { data, error } = await admin.rpc("apply_successful_payment", {
        p_reference: input.reference,
        p_amount_kobo: input.amountKobo,
        p_currency: input.currency,
        p_environment: input.environment,
        p_provider_transaction_id: input.providerTransactionId,
        p_provider_status: input.providerStatus,
        p_paid_at: input.paidAt,
      });
      if (error) {
        console.error(`[billing] payment application failed: ${error.code ?? "unknown"}`);
        return { outcome: "apply_failed", userId: null, expiresAt: null };
      }
      const row = (data as unknown as ApplyRow[])?.[0];
      return {
        outcome: row?.outcome ?? "apply_failed",
        userId: row?.user_id ?? null,
        expiresAt: row?.expires_at ?? null,
      };
    },

    async markUnsuccessful(input) {
      const { error } = await admin.rpc("mark_billing_payment_unsuccessful", {
        p_reference: input.reference,
        p_status: input.status,
        p_reason: input.reason,
        p_provider_status: input.providerStatus,
      });
      if (error) console.error(`[billing] payment failure record failed: ${error.code ?? "unknown"}`);
    },
  };
}
