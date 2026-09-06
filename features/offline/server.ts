import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionKind } from "./types";
export async function getRevisions(userId: string, kind: SessionKind, sessionId: string) {
  const { data, error } = await createAdminClient().from("response_revisions").select("question_id, revision").eq("user_id", userId).eq("kind", kind).eq("session_id", sessionId);
  if (error) throw new Error("Could not load answer revisions. Check that the M6 migration is applied.");
  return new Map(data.map(r => [r.question_id, r.revision]));
}
export function parseRevision(body: Record<string, unknown>) {
  if (typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
    || typeof body.mutationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.mutationId)) {
    throw new Error("This app version cannot safely save answers. Reload to update it.");
  }
  return { expectedRevision: body.expectedRevision, mutationId: body.mutationId };
}
/** Client clocks may be wrong. Only the server decides whether automatic expiry is due. */
export async function checkAutomaticExpiry(userId: string, kind: SessionKind, sessionId: string) {
  const db = createAdminClient();
  const response = kind === "exam"
    ? await db.from("exam_attempts").select("expires_at, status").eq("user_id", userId).eq("id", sessionId).maybeSingle()
    : await db.from("practice_sessions").select("expires_at, status").eq("user_id", userId).eq("id", sessionId).maybeSingle();
  if (response.error || !response.data) throw new Error("SESSION_NOT_FOUND");
  const serverNow = Date.now();
  return response.data.status === "in_progress" && (!response.data.expires_at || Date.parse(response.data.expires_at) > serverNow) ? serverNow : null;
}
