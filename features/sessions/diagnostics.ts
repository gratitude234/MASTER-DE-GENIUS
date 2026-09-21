/**
 * Why a session would not open, as a server-side fact.
 *
 * A student who taps a practice session and is told "We could not open this
 * session" has been told nothing, and until now neither had we: the route's
 * error boundary caught whatever was thrown, printed one friendly paragraph and
 * discarded the reason. A missing session, someone else's session, a snapshot
 * written by a newer build, an exhausted quota and a database outage all looked
 * identical from the outside *and* from the logs, so the first question of any
 * investigation — which of those happened? — had no answer.
 *
 * This module is the vocabulary. The student-facing copy does not change and
 * deliberately says the same calm thing in every case; what changes is that the
 * server now records which case it was, in one structured line an admin can
 * grep and count.
 *
 * Nothing here is ever rendered. A `SessionOpenError` carries an internal
 * `detail` for the log and a separate `studentMessage` for the screen, the same
 * split `QuestionProviderError` already uses, so the two cannot be confused at
 * a call site.
 */

/** The failure classes a session open can end in. */
export type SessionOpenFailure =
  /** No session with this id exists — including an id that is not a uuid. */
  | "SESSION_NOT_FOUND"
  /** The session exists and belongs to someone else. */
  | "SESSION_FORBIDDEN"
  /** The row exists but its questions do not: creation did not finish. */
  | "SESSION_INCOMPLETE"
  /** A stored snapshot is not an object. */
  | "SNAPSHOT_INVALID"
  /** A stored snapshot was written by a build newer than this one. */
  | "SNAPSHOT_SCHEMA_UNSUPPORTED"
  /** A stored snapshot is an object but carries no answerable question. */
  | "QUESTION_DESERIALIZATION_FAILED"
  /** The student's plan does not entitle them to open this session. */
  | "ENTITLEMENT_BLOCKED"
  /** The student's allowance for this session is exhausted. */
  | "QUOTA_BLOCKED"
  /** A database function returned an error. */
  | "RPC_FAILED"
  /** A query failed: connection, permission, constraint, malformed input. */
  | "DATABASE_ERROR"
  /** Anything that escaped classification. Should trend to zero. */
  | "UNKNOWN";

/** Which engine the session belongs to, so one log line serves both. */
export type SessionKind = "practice" | "exam";

/**
 * The one sentence a student sees, whatever went wrong.
 *
 * Identical for every class on purpose. "This session belongs to another
 * account" confirms to whoever holds the link that the id is real and in use,
 * and "snapshot schema unsupported" asks a sixteen-year-old to debug a
 * deployment. The route copy stays calm and true; the class goes to the log.
 */
export const SESSION_OPEN_STUDENT_MESSAGE =
  "We could not open this session. Your saved answers are safe.";

export interface SessionOpenDiagnostic {
  failure: SessionOpenFailure;
  kind: SessionKind;
  sessionId: string;
  /** Internal detail: a provider id, a Postgres code, a field name. Never an answer key. */
  detail?: string;
  /** Set when a snapshot needed legacy defaults, so old sessions can be counted. */
  legacySnapshot?: boolean;
  /** Which question position failed, when the failure is per-question. */
  position?: number;
}

/**
 * A classified session-open failure.
 *
 * `message` is the internal one and belongs in a log; `studentMessage` is the
 * only text safe to render.
 */
export class SessionOpenError extends Error {
  readonly studentMessage = SESSION_OPEN_STUDENT_MESSAGE;

  constructor(readonly diagnostic: SessionOpenDiagnostic) {
    super(`${diagnostic.failure}: ${diagnostic.detail ?? "no detail"}`);
    this.name = "SessionOpenError";
  }
}

/**
 * Postgres codes that mean "this id could not name a row", not "the database
 * is unwell".
 *
 * `22P02` is invalid text representation — what PostgREST returns for a session
 * id that is not a uuid. A stale bookmark, a hand-edited link or a client that
 * kept an id across a data reset all produce it, and every one of them is a
 * missing session, not a server fault. Reported as a 500 it is an incident; as
 * a 404 it is a dead link, which is what it is.
 */
const NOT_FOUND_CODES = new Set(["22P02", "PGRST116"]);

interface PostgresErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/**
 * Classifies an error returned by a Supabase query.
 *
 * `rpc` separates a failing database function from a failing table read,
 * because they are investigated in completely different places.
 */
export function classifyDatabaseError(
  error: PostgresErrorLike,
  options: { rpc?: boolean } = {},
): { failure: SessionOpenFailure; detail: string } {
  const code = error.code ?? "";
  const detail = `${code || "no-code"}: ${(error.message ?? "no message").slice(0, 300)}`;
  if (NOT_FOUND_CODES.has(code)) return { failure: "SESSION_NOT_FOUND", detail };
  return { failure: options.rpc ? "RPC_FAILED" : "DATABASE_ERROR", detail };
}

/**
 * One structured line per refused session open.
 *
 * Deliberately one line and deliberately greppable: the reason an admin is
 * reading this at all is to answer "how many students hit this, and which
 * defect?", which means counting, not reading prose. It carries no student
 * identity — a session id is enough to find the row, and pairing it with a user
 * id would put an identifiable trail of one student's activity into the log.
 */
export function logSessionOpenFailure(diagnostic: SessionOpenDiagnostic): void {
  const fields = [
    `failure=${diagnostic.failure}`,
    `kind=${diagnostic.kind}`,
    `session=${diagnostic.sessionId}`,
    diagnostic.position !== undefined ? `position=${diagnostic.position}` : null,
    diagnostic.legacySnapshot !== undefined ? `legacySnapshot=${diagnostic.legacySnapshot}` : null,
    diagnostic.detail ? `detail=${JSON.stringify(diagnostic.detail)}` : null,
  ].filter(Boolean);

  console.error(`[session-open] ${fields.join(" ")}`);
}

/** The internal description of an error that carries no classification of its own. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 300)}`;
  return `non-error thrown: ${typeof error}`;
}

/**
 * Classifies anything thrown while opening a session, and records it.
 *
 * A `SessionOpenError` already knows what it is and is passed through
 * unchanged, so a failure is logged exactly once by whichever layer recognised
 * it. Everything else is classified by the `fallback` the call site can vouch
 * for — a throw from the entitlement read is `ENTITLEMENT_BLOCKED`, and a throw
 * from nowhere in particular is `UNKNOWN`. Nothing is inferred from message
 * text: a log that guesses reads as precisely as one that knows, which is worse
 * than admitting the gap.
 */
export function toSessionOpenError(
  error: unknown,
  kind: SessionKind,
  sessionId: string,
  fallback: SessionOpenFailure = "UNKNOWN",
): SessionOpenError {
  if (error instanceof SessionOpenError) return error;
  const diagnostic: SessionOpenDiagnostic = {
    failure: fallback, kind, sessionId, detail: describeError(error),
  };
  logSessionOpenFailure(diagnostic);
  return new SessionOpenError(diagnostic);
}
