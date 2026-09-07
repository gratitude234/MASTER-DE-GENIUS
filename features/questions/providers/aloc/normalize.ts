import "server-only";

import type { CanonicalQuestion, QuestionPassage } from "@/features/questions/types";
import type { ExamBody, QuestionAsset, QuestionOption } from "@/types/domain";

/**
 * Legacy ALOC payloads are loosely typed and vary between subjects, so every
 * field arrives as `unknown` and is validated before use. Nothing in this shape
 * may escape the ALOC adapter.
 */
export interface AlocRawQuestion {
  id?: unknown;
  question?: unknown;
  option?: unknown;
  options?: unknown;
  answer?: unknown;
  section?: unknown;
  image?: unknown;
  solution?: unknown;
  examtype?: unknown;
  examyear?: unknown;
  hasPassage?: unknown;
}

export interface NormalizeContext {
  examBody: ExamBody;
  subjectSlug: string;
  subjectName: string;
}

/** Why a question was rejected. Surfaced by the smoke script, never to students. */
export type DiscardReason =
  | "missing_id"
  | "empty_prompt"
  | "too_few_options"
  | "duplicate_option_key"
  | "unresolved_answer"
  | "invalid_structure";

const OPTION_ORDER: QuestionOption["key"][] = ["A", "B", "C", "D", "E"];
const OPTION_KEYS = new Set<string>(OPTION_ORDER);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  deg: "°", times: "×", divide: "÷", plusmn: "±",
  frac12: "½", frac14: "¼", frac34: "¾",
  sup2: "²", sup3: "³", micro: "µ",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ",
  pi: "π", theta: "θ", lambda: "λ", omega: "ω",
  rarr: "→", larr: "←", harr: "↔",
  le: "≤", ge: "≥", ne: "≠",
};

// Conservative: a run only counts as markup when it looks like a real tag, so
// mathematical text such as "x < 5" survives untouched.
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;
const LINE_BREAK_TAG = /<\s*(?:br\s*\/?|\/\s*(?:p|div|li|tr|h[1-6]))\s*>/gi;

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Markup is removed before entities are decoded, so an escaped `&lt;` becomes a
 * literal "<" instead of being mistaken for a tag and deleted. React already
 * escapes on render, so the product keeps one safe renderer and never needs
 * dangerouslySetInnerHTML.
 */
export function cleanText(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  return decodeEntities(value.replace(LINE_BREAK_TAG, "\n").replace(TAG, ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeOptionKey(value: unknown): QuestionOption["key"] | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().toLowerCase().replace(/[.)\]:]+$/, "");
  const match = /^(?:option[\s_-]?)?([a-e])$/.exec(raw);
  if (!match) return null;
  const key = match[1].toUpperCase();
  return OPTION_KEYS.has(key) ? (key as QuestionOption["key"]) : null;
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?'"()]/g, "").trim();
}

interface NormalizedOptions {
  options: QuestionOption[];
  error?: DiscardReason;
}

export function normalizeOptions(raw: unknown, questionId: string): NormalizedOptions {
  const collected = new Map<QuestionOption["key"], string>();

  const add = (key: QuestionOption["key"] | null, text: unknown): DiscardReason | null => {
    if (!key) return null;
    const value = cleanText(text);
    if (!value) return null;              // ALOC returns null/"" for an absent 5th option.
    if (collected.has(key)) return "duplicate_option_key";
    collected.set(key, value);
    return null;
  };

  if (Array.isArray(raw)) {
    for (let index = 0; index < raw.length && index < OPTION_ORDER.length; index += 1) {
      const failure = add(OPTION_ORDER[index], raw[index]);
      if (failure) return { options: [], error: failure };
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const failure = add(normalizeOptionKey(key), value);
      if (failure) return { options: [], error: failure };
    }
  } else {
    return { options: [], error: "invalid_structure" };
  }

  const options = OPTION_ORDER.filter((key) => collected.has(key)).map((key) => ({
    id: `aloc:${questionId}:${key}`,
    key,
    text: collected.get(key)!,
  }));

  if (options.length < 2) return { options: [], error: "too_few_options" };
  return { options };
}

/**
 * Resolves the answer key by letter first, then by an unambiguous match against
 * the option text. Anything else is unresolvable: the question is discarded
 * rather than guessed, because a wrong key silently corrupts grading.
 */
export function resolveAnswerKey(raw: unknown, options: QuestionOption[]): QuestionOption["key"] | null {
  const byKey = normalizeOptionKey(raw);
  if (byKey && options.some((option) => option.key === byKey)) return byKey;

  const answerText = cleanText(raw);
  if (!answerText) return null;

  const target = comparable(answerText);
  if (!target) return null;

  const matches = options.filter((option) => comparable(option.text) === target);
  return matches.length === 1 ? matches[0].key : null;
}

/** Deterministic FNV-1a. Questions sharing a passage body share its identifier. */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * `section` is not a passage field. Live responses put instruction text in it for
 * most English questions ("In each of questions 86 to 100, choose the option
 * opposite in meaning to the underlined word(s)."), and only comprehension
 * questions carry `hasPassage: 1`. Trusting length alone rendered instruction
 * lines as passages, which is fabricated content; the flag is authoritative when
 * present, and the length heuristic only applies when the field is absent.
 */
export function normalizePassage(raw: unknown, hasPassage?: unknown): QuestionPassage | null {
  if (hasPassage !== undefined && !Number(hasPassage)) return null;

  let title: string | null = null;
  let body = "";

  if (typeof raw === "string") {
    body = cleanText(raw);
  } else if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    body = cleanText(record.passage ?? record.content ?? record.body ?? record.text ?? record.instruction);
    title = cleanText(record.theme ?? record.title ?? record.name) || null;
  }

  // Fallback for a payload without the flag: a bare instruction line is not a
  // comprehension passage, and inventing one would put fabricated content on screen.
  if (!body || body.length < 40) return null;
  return { id: `aloc:passage:${stableHash(body)}`, title, body };
}

function normalizeYear(raw: unknown): number | null {
  const year = typeof raw === "number" ? raw : Number.parseInt(cleanText(raw), 10);
  return Number.isInteger(year) && year >= 1960 && year <= 2100 ? year : null;
}

function normalizeAssets(raw: unknown, questionId: string): QuestionAsset[] {
  const url = cleanText(raw);
  if (!url || !/^https?:\/\//i.test(url)) return [];
  return [{ id: `aloc:${questionId}:image`, kind: "image", url, altText: null, caption: null }];
}

export interface NormalizeResult {
  question?: CanonicalQuestion;
  discarded?: DiscardReason;
}

/**
 * Converts one raw ALOC record into a CanonicalQuestion, or reports why it was
 * rejected. A malformed record never throws: one bad question must not fail an
 * entire batch.
 */
export function normalizeAlocQuestion(raw: unknown, context: NormalizeContext): NormalizeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { discarded: "invalid_structure" };
  const record = raw as AlocRawQuestion;

  const providerQuestionId = typeof record.id === "number" || typeof record.id === "string"
    ? String(record.id).trim()
    : "";
  if (!providerQuestionId) return { discarded: "missing_id" };

  const prompt = cleanText(record.question);
  if (!prompt) return { discarded: "empty_prompt" };

  const { options, error } = normalizeOptions(record.option ?? record.options, providerQuestionId);
  if (error) return { discarded: error };

  const correctOptionKey = resolveAnswerKey(record.answer, options);
  if (!correctOptionKey) return { discarded: "unresolved_answer" };

  return {
    question: {
      id: `aloc:${context.subjectSlug}:${providerQuestionId}`,
      source: { provider: "aloc", providerQuestionId, internalQuestionId: null },
      examBody: context.examBody,
      subject: { id: context.subjectSlug, slug: context.subjectSlug, name: context.subjectName },
      topic: null,
      year: normalizeYear(record.examyear),
      prompt,
      passage: normalizePassage(record.section, record.hasPassage),
      assets: normalizeAssets(record.image, providerQuestionId),
      options,
      correctOptionKey,
      explanation: cleanText(record.solution) || null,
      difficulty: null,
    },
  };
}
