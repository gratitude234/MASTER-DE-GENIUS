import "server-only";

import {
  cleanText,
  normalizeOptions,
  normalizeQuestionAssets,
  normalizeSection,
  resolveAnswerKey,
} from "@/features/questions/providers/aloc/normalize";
import type { CanonicalQuestion } from "@/features/questions/types";
import type { ExamBody, QuestionAsset } from "@/types/domain";

import { sdashExamTypeAliases } from "./mapping";

/**
 * Sdash V1 records are the same loose legacy shape the ALOC adapters already
 * handle — `id`, `question`, `section`, `option`, `answer`, `solution`,
 * `image`, `examtype`, `examyear` — so the text cleaner, the option/answer
 * resolver and, most importantly, the instruction/passage classifier are reused
 * rather than reimplemented. A second copy of those regexes would be a second
 * set of rules, and Practice must behave identically whichever provider a
 * subject happens to route to.
 *
 * Provider field names stop at this module. Nothing above it sees `examtype`,
 * `option` or `solution`.
 */

export interface SdashNormalizeContext {
  examBody: ExamBody;
  subjectSlug: string;
  subjectName: string;
  /** The upstream exam type requested, e.g. "wassce". Used to reject drift. */
  examType: string;
}

export type SdashDiscardReason =
  | "missing_id"
  | "empty_prompt"
  | "too_few_options"
  | "duplicate_option_key"
  | "unresolved_answer"
  | "invalid_structure"
  | "exam_mismatch";

function normalizeYear(raw: unknown): number | null {
  // `examyear` arrives as a string in every observed response.
  const year = typeof raw === "number" ? raw : Number.parseInt(cleanText(raw), 10);
  return Number.isInteger(year) && year >= 1960 && year <= 2100 ? year : null;
}

/**
 * Sdash names its visual `image`; it is null for most records.
 *
 * Field selection, URL safety and worked-answer exclusion all live in the
 * shared normalizer, so Sdash cannot drift from the ALOC adapters the way the
 * Station one did. Nothing is repaired here: a question whose prompt needs a
 * diagram it did not receive is refused later by the shared integrity
 * validator, which is the single place that decides deliverability.
 */
function normalizeAssets(record: Record<string, unknown>, questionId: string): QuestionAsset[] {
  return normalizeQuestionAssets({
    prefix: "sdash",
    questionId,
    record,
    inlineSources: [record.question, record.section],
  });
}

/**
 * Guards against a WASSCE request being answered with a UTME record.
 *
 * Only a populated, contradicting value counts: an absent `examtype` is not
 * evidence of anything and must not cost a student a valid question.
 */
function examTypeMatches(raw: unknown, examType: string): boolean {
  const declared = cleanText(raw).toLowerCase();
  if (!declared) return true;
  return sdashExamTypeAliases(examType).has(declared);
}

export interface SdashNormalizeResult {
  question?: CanonicalQuestion;
  discarded?: SdashDiscardReason;
}

/**
 * Converts one raw Sdash record into a `CanonicalQuestion`, or reports why it
 * was rejected. A malformed record never throws: one bad question must not fail
 * an entire batch, and an answer is never guessed.
 */
export function normalizeSdashQuestion(
  raw: unknown,
  context: SdashNormalizeContext,
): SdashNormalizeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { discarded: "invalid_structure" };
  const record = raw as Record<string, unknown>;

  const providerQuestionId = typeof record.id === "string" || typeof record.id === "number"
    ? String(record.id).trim()
    : "";
  if (!providerQuestionId) return { discarded: "missing_id" };

  if (!examTypeMatches(record.examtype, context.examType)) return { discarded: "exam_mismatch" };

  const prompt = cleanText(record.question);
  if (!prompt) return { discarded: "empty_prompt" };

  const normalized = normalizeOptions(record.option ?? record.options, providerQuestionId);
  if (normalized.error) return { discarded: normalized.error };

  const correctOptionKey = resolveAnswerKey(record.answer, normalized.options);
  if (!correctOptionKey) return { discarded: "unresolved_answer" };

  /*
   * `section` is not a passage field. Sdash inherits it from the same legacy
   * shape as ALOC, where it holds a rubric at least as often as source
   * material, and V1 carries no `hasPassage` flag. Passing `undefined` selects
   * the classifier's no-flag branch: instruction-shaped text becomes an
   * instruction, text too short to be source material is dropped, and only
   * genuine prose becomes a passage. Nothing is written — text is classified,
   * never invented.
   */
  const material = normalizeSection(record.section);

  return {
    question: {
      id: `sdash:${context.examBody}:${context.subjectSlug}:${providerQuestionId}`,
      source: { provider: "sdash", providerQuestionId, internalQuestionId: null },
      examBody: context.examBody,
      subject: { id: context.subjectSlug, slug: context.subjectSlug, name: context.subjectName },
      // V1 carries neither topic nor difficulty. Both stay null rather than
      // being inferred, so no filter can ever be honoured by invention.
      topic: null,
      year: normalizeYear(record.examyear ?? record.year),
      instruction: material.instruction,
      prompt,
      passage: material.passage,
      assets: normalizeAssets(record, providerQuestionId),
      options: normalized.options.map((option) => ({
        ...option,
        id: `sdash:${providerQuestionId}:${option.key}`,
      })),
      correctOptionKey,
      explanation: cleanText(record.solution) || null,
      difficulty: null,
    },
  };
}
