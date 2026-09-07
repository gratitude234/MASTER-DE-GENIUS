import "server-only";

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Suppresses duplicate session creation.
 *
 * A session is only created after the question provider has been asked for
 * questions, and that call can take seconds. A double-tap, a retried POST or a
 * second open tab can therefore all get past any "do you already have one?"
 * check before the first request finishes, and each would buy its own batch of
 * provider questions.
 *
 * The browser's own `starting` flag cannot prevent this: it is per-tab, and it
 * disappears the moment the page reloads. The claim below is taken server-side
 * before the provider is contacted, so the guarantee does not depend on the
 * client behaving.
 *
 * This is deliberately NOT "one practice session at a time". A student may run
 * several sessions, and may legitimately repeat an identical setup later. Only
 * an identical request arriving while one is in flight — or within a few seconds
 * of one succeeding — is treated as a duplicate.
 */

export type CreationKind = "practice" | "exam";

export type ClaimOutcome =
  | { status: "claimed" }
  | { status: "duplicate"; sessionId: string }
  | { status: "in_progress" };

/** Stable, short, and free of anything sensitive: it identifies a request shape. */
export function creationFingerprint(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

interface ClaimRow {
  outcome: string;
  session_id: string | null;
}

/**
 * Attempts to take ownership of one creation.
 *
 * Fails open, unlike the rate limiter. A claim exists only to avoid buying the
 * same questions twice; refusing a student's session because the bookkeeping
 * table was briefly unavailable would trade a rare, bounded cost for a visible
 * outage. The rate limiter still bounds total spend.
 */
export async function claimCreation(
  userId: string,
  kind: CreationKind,
  fingerprint: string,
): Promise<ClaimOutcome> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_session_creation", {
    p_user_id: userId,
    p_kind: kind,
    p_fingerprint: fingerprint,
  });

  if (error) {
    console.error(`[creation-claim] ${kind} claim failed: ${error.message}`);
    return { status: "claimed" };
  }

  const row = (data as unknown as ClaimRow[])?.[0];
  if (!row) return { status: "claimed" };

  if (row.outcome === "duplicate" && row.session_id) {
    return { status: "duplicate", sessionId: row.session_id };
  }
  if (row.outcome === "in_progress") return { status: "in_progress" };
  return { status: "claimed" };
}

/**
 * Closes a claim: records the created session, or releases the claim entirely
 * when `sessionId` is null so a failed attempt can be retried immediately
 * instead of waiting out the in-flight window.
 */
export async function settleCreation(
  userId: string,
  kind: CreationKind,
  fingerprint: string,
  sessionId: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("settle_session_creation", {
    p_user_id: userId,
    p_kind: kind,
    p_fingerprint: fingerprint,
    p_session_id: sessionId,
  });

  // A claim that is never settled expires on its own, so this must not turn a
  // successful creation into a failed request.
  if (error) console.error(`[creation-claim] ${kind} settle failed: ${error.message}`);
}
