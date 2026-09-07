import "server-only";

import type { CanonicalQuestion } from "@/features/questions/types";
import { cleanText, normalizeOptions, normalizePassage, resolveAnswerKey } from "@/features/questions/providers/aloc/normalize";
import type { ExamBody, QuestionAsset, QuestionDifficulty } from "@/types/domain";

export interface StationNormalizeContext {
  examBody: ExamBody;
  subjectSlug: string;
  subjectName: string;
}

export type StationDiscardReason =
  | "missing_id"
  | "empty_prompt"
  | "too_few_options"
  | "duplicate_option_key"
  | "unresolved_answer"
  | "invalid_structure";

function normalizeYear(raw: unknown): number | null {
  const year = typeof raw === "number" ? raw : Number.parseInt(cleanText(raw), 10);
  return Number.isInteger(year) && year >= 1960 && year <= 2100 ? year : null;
}

function normalizeDifficulty(raw: unknown): QuestionDifficulty | null {
  const value = cleanText(raw).toLowerCase();
  if (value === "easy" || value === "medium" || value === "hard") return value;
  return null;
}

function normalizeAssets(raw: unknown, questionId: string): QuestionAsset[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.flatMap((value, index) => {
    const candidate = value && typeof value === "object"
      ? (value as Record<string, unknown>).url
      : value;
    const url = cleanText(candidate);
    if (!/^https?:\/\//i.test(url)) return [];
    return [{ id: `aloc-station:${questionId}:asset:${index + 1}`, kind: "image" as const, url, altText: null, caption: null }];
  });
}

export function normalizeStationQuestion(
  raw: unknown,
  context: StationNormalizeContext,
): { question?: CanonicalQuestion; discarded?: StationDiscardReason } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { discarded: "invalid_structure" };
  const record = raw as Record<string, unknown>;
  const providerQuestionId = typeof record.id === "string" || typeof record.id === "number"
    ? String(record.id).trim()
    : "";
  if (!providerQuestionId) return { discarded: "missing_id" };

  const prompt = cleanText(record.text ?? record.questionHtml ?? record.question);
  if (!prompt) return { discarded: "empty_prompt" };

  const normalized = normalizeOptions(record.options ?? record.option, providerQuestionId);
  if (normalized.error) return { discarded: normalized.error };
  const correctOptionKey = resolveAnswerKey(record.correctAnswer ?? record.answer, normalized.options);
  if (!correctOptionKey) return { discarded: "unresolved_answer" };

  return {
    question: {
      id: `aloc-station:${context.examBody}:${context.subjectSlug}:${providerQuestionId}`,
      source: { provider: "aloc_station", providerQuestionId, internalQuestionId: null },
      examBody: context.examBody,
      subject: { id: context.subjectSlug, slug: context.subjectSlug, name: context.subjectName },
      topic: null,
      year: normalizeYear(record.year ?? record.examYear),
      prompt,
      passage: normalizePassage(record.section ?? record.passage, record.hasPassage),
      assets: normalizeAssets(record.assets ?? record.image, providerQuestionId),
      options: normalized.options.map((option) => ({ ...option, id: `aloc-station:${providerQuestionId}:${option.key}` })),
      correctOptionKey,
      explanation: null,
      difficulty: normalizeDifficulty(record.difficultyLevel ?? record.difficulty),
    },
  };
}
