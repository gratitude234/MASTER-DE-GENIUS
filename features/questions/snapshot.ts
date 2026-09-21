/**
 * Reading a frozen student snapshot back out of the database.
 *
 * A practice session or mock attempt freezes its questions at creation: the
 * student sees the paper as it was the day they started it, whatever the
 * provider does afterwards. That guarantee only holds if a snapshot written by
 * an older build stays readable by a newer one.
 *
 * It nearly stopped holding. The question model grew `instruction`, then
 * `assets`, then `passage.kind` and `discardedContext`, and the runners read
 * some of those fields unconditionally — `question.assets.length` throws on a
 * snapshot that has no `assets`, and the student is shown "We could not open
 * this session" with the reason discarded. A frozen session must never become
 * unreadable because a later release added an optional field.
 *
 * So this module is the single door every stored snapshot comes through. It is
 * pure and synchronous, performs no I/O, and carries no `server-only` marker so
 * tests can drive it directly.
 *
 * Two rules govern it:
 *
 *   - **Supply, never refuse.** A missing optional field gets the default that
 *     reproduces how that snapshot rendered before the field existed. Nothing
 *     that renders today may stop rendering because it passed through here.
 *   - **Read, never write.** Defaults are applied to the value in memory. The
 *     stored row is not migrated, rewritten or touched, so completed-session
 *     history stays exactly as it was graded.
 *
 * A snapshot that genuinely cannot be shown is classified rather than thrown,
 * so the caller can log *which* defect occurred and still tell the student
 * something calm and true.
 */

import type { QuestionContextKind } from "@/features/questions/context";
import type { StudentQuestion } from "@/features/questions/types";
import type { QuestionAsset, QuestionOption } from "@/types/domain";

/**
 * The snapshot shape this build writes.
 *
 * Absent from every snapshot frozen before it existed, and absence means
 * "legacy, fully supported" — it is never a failure. It exists for the opposite
 * direction: after a rollback, a build can find a snapshot written by a *newer*
 * one and say so precisely instead of rendering it half-understood. That is the
 * one realistic way a deployment can make a valid session unreadable, and it is
 * worth being able to name.
 */
export const STUDENT_SNAPSHOT_SCHEMA = 1;

/** Why a stored snapshot could not become a question. Diagnostic only. */
export type SnapshotReadFailure =
  /** Not an object at all — null, a string, an array, a JSON scalar. */
  | "SNAPSHOT_INVALID"
  /** Written by a build newer than this one, so its shape is not understood. */
  | "SNAPSHOT_SCHEMA_UNSUPPORTED"
  /** An object, but it carries no answerable question: the options are unusable. */
  | "QUESTION_DESERIALIZATION_FAILED";

export interface SnapshotReadResult {
  /** The question to render, or null when `failure` is set. */
  question: StudentQuestion | null;
  /**
   * Everything that *could* be read when `question` is null — subject, topic,
   * year, source, and the prompt if there was one — with an empty option list.
   *
   * It exists because a results page must survive one bad snapshot. The score,
   * the mistake bank and the revision builder all key off `subject.slug`, so a
   * placeholder that dropped it would quietly delete the question from a
   * student's revision list instead of merely failing to draw it. Null when the
   * snapshot's shape was not understood at all, because then nothing readable
   * can be claimed.
   *
   * Never a substitute for `question`: a session a student is about to answer
   * is still refused.
   */
  partial?: StudentQuestion | null;
  failure?: SnapshotReadFailure;
  /** What was wrong, for server diagnostics. Never contains an answer key. */
  detail?: string;
  /**
   * True when a field a newer build writes was absent and a default was
   * supplied. Purely observational — it tells an admin that old snapshots are
   * still in circulation, and never changes what the student sees.
   */
  legacy: boolean;
}

const OPTION_KEYS = new Set<QuestionOption["key"]>(["A", "B", "C", "D", "E"]);

/**
 * Options needed before a snapshot counts as readable.
 *
 * One, not two. A paper with a single choice is a poor question, and the
 * adapters already refuse `too_few_options` at the point a session is frozen —
 * which is where that judgement belongs. Re-applying it on the way *out* would
 * mean a rule tightened in a later release could retroactively brick a session
 * a student is halfway through, which is the exact failure this module exists
 * to prevent. So the read asks only whether there is something to render.
 */
const MIN_OPTIONS = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | null {
  const resolved = text(value).trim();
  return resolved ? text(value) : null;
}

/**
 * The option list, or null when it cannot be shown.
 *
 * The only part of a snapshot that can fail: everything else has a safe
 * default, but a question with no usable choices is not a question. An option
 * missing its `id` is given a stable one rather than being dropped — the id is
 * a rendering key, not examination content, and losing a choice would change
 * the paper.
 */
function readOptions(value: unknown, questionId: string): QuestionOption[] | null {
  if (!Array.isArray(value)) return null;

  const options: QuestionOption[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const key = text(raw.key).trim().toUpperCase();
    if (!OPTION_KEYS.has(key as QuestionOption["key"])) continue;
    options.push({
      id: text(raw.id).trim() || `${questionId}:${key}`,
      key: key as QuestionOption["key"],
      text: text(raw.text),
    });
  }

  return options.length >= MIN_OPTIONS ? options : null;
}

/**
 * Visuals, defaulting to none.
 *
 * `assets` is required by the current model and absent from snapshots frozen
 * before it was, which is exactly the shape that crashed the runners. A
 * snapshot with no assets is a question with no picture — which is how it
 * always rendered — not a broken session.
 */
function readAssets(value: unknown, questionId: string): QuestionAsset[] {
  if (!Array.isArray(value)) return [];

  const assets: QuestionAsset[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const url = text(raw.url).trim();
    if (!url) continue;
    assets.push({
      id: text(raw.id).trim() || `${questionId}:asset:${assets.length}`,
      // Pre-dates the asset-kind field; every such asset was an image.
      kind: (text(raw.kind).trim() || "image") as QuestionAsset["kind"],
      url,
      altText: optionalText(raw.altText),
      caption: optionalText(raw.caption),
    });
  }
  return assets;
}

/**
 * The context block, defaulting to none.
 *
 * `kind` is left exactly as stored, including absent. Every snapshot frozen
 * before `kind` existed holds genuine prose — the malformed ones are what that
 * work removed — and `isProseContext` already reads a missing kind as prose, so
 * an old passage keeps the heading and the layout it always had. Supplying
 * `"passage"` here would look harmless and would quietly relabel any future
 * snapshot whose kind failed to serialise.
 */
function readPassage(value: unknown, questionId: string): StudentQuestion["passage"] {
  if (!isRecord(value)) return null;
  const body = text(value.body);
  if (!body.trim()) return null;

  const kind = text(value.kind).trim();
  return {
    id: text(value.id).trim() || `${questionId}:passage`,
    title: optionalText(value.title),
    body,
    ...(kind ? { kind: kind as QuestionContextKind } : {}),
  };
}

function readDiscardedContext(value: unknown): StudentQuestion["discardedContext"] {
  if (!isRecord(value)) return null;
  const kind = text(value.kind).trim();
  if (!kind) return null;
  const detail = optionalText(value.detail);
  return { kind: kind as QuestionContextKind, ...(detail ? { detail } : {}) };
}

/** Fields a build older than the current model never wrote. */
const FIELDS_ADDED_AFTER_LAUNCH = ["assets", "instruction", "discardedContext"] as const;

/**
 * Every field except the options, read with defaults.
 *
 * Separate from the option list because the options are the only part that can
 * fail, and when they do the rest is still worth having — see `partial`.
 */
function readFields(
  value: Record<string, unknown>,
  questionId: string,
  options: QuestionOption[],
): StudentQuestion {
  const subject = isRecord(value.subject) ? value.subject : {};
  const topic = isRecord(value.topic) ? value.topic : null;
  const source = isRecord(value.source) ? value.source : {};

  return {
    id: questionId,
    source: {
      provider: text(source.provider) || "unknown",
      providerQuestionId: text(source.providerQuestionId),
      internalQuestionId: optionalText(source.internalQuestionId),
    },
    examBody: value.examBody as StudentQuestion["examBody"],
    subject: { id: text(subject.id), slug: text(subject.slug), name: text(subject.name) },
    topic: topic
      ? { id: text(topic.id), subjectId: text(topic.subjectId), slug: text(topic.slug), name: text(topic.name) }
      : null,
    year: typeof value.year === "number" ? value.year : null,
    instruction: optionalText(value.instruction),
    prompt: text(value.prompt),
    passage: readPassage(value.passage, questionId),
    discardedContext: readDiscardedContext(value.discardedContext),
    assets: readAssets(value.assets, questionId),
    options,
    difficulty: (["easy", "medium", "hard"] as const).includes(value.difficulty as "easy")
      ? (value.difficulty as StudentQuestion["difficulty"])
      : null,
  };
}

/**
 * Turns one stored `student_snapshot` into a question the runners can render,
 * or says why it cannot.
 *
 * `fallbackId` is the session-question row id, used only to synthesise
 * rendering keys when the snapshot has none. It never reaches the student.
 */
export function readStudentSnapshot(value: unknown, fallbackId: string): SnapshotReadResult {
  if (!isRecord(value)) {
    return {
      question: null, partial: null,
      failure: "SNAPSHOT_INVALID",
      detail: `stored snapshot is ${value === null ? "null" : Array.isArray(value) ? "an array" : typeof value}`,
      legacy: false,
    };
  }

  const schema = typeof value.schemaVersion === "number" ? value.schemaVersion : null;
  if (schema !== null && schema > STUDENT_SNAPSHOT_SCHEMA) {
    // No partial: a shape this build does not understand cannot be read in part
    // either, and guessing at its fields is how a newer model gets mis-rendered.
    return {
      question: null, partial: null,
      failure: "SNAPSHOT_SCHEMA_UNSUPPORTED",
      detail: `snapshot schema ${schema} is newer than this build understands (${STUDENT_SNAPSHOT_SCHEMA})`,
      legacy: false,
    };
  }

  const questionId = text(value.id).trim() || fallbackId;
  const options = readOptions(value.options, questionId);
  if (!options) {
    return {
      question: null,
      partial: readFields(value, questionId, []),
      failure: "QUESTION_DESERIALIZATION_FAILED",
      // Counts only. The option text is the visible answer list and does not
      // belong in a log line that may be aggregated.
      detail: `snapshot has ${Array.isArray(value.options) ? `${value.options.length} option entries and none usable` : "no option array"}`,
      legacy: false,
    };
  }

  return {
    legacy: FIELDS_ADDED_AFTER_LAUNCH.some((field) => !(field in value)),
    question: readFields(value, questionId, options),
  };
}
