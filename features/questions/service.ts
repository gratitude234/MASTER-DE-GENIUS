import "server-only";

import { toStudentQuestions } from "@/features/questions/delivery";
import { QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import { getQuestionProvider } from "@/features/questions/providers";
import type { QuestionProvider } from "@/features/questions/providers/types";
import type { CanonicalQuestion, QuestionQuery, StudentQuestion } from "@/features/questions/types";
import type { ExamBody } from "@/types/domain";

const MAX_BATCH_SIZE = 100;

function validateQuery(query: QuestionQuery): QuestionQuery {
  if (!Number.isInteger(query.count) || query.count < 1 || query.count > MAX_BATCH_SIZE) {
    throw new Error(`Question count must be between 1 and ${MAX_BATCH_SIZE}.`);
  }

  if (query.year != null && (!Number.isInteger(query.year) || query.year < 1960 || query.year > 2100)) {
    throw new Error("Question year is invalid.");
  }

  return query;
}

/**
 * A filter the active provider cannot honour must fail before a session is
 * frozen. Silently dropping it would label a set of unrelated questions with a
 * topic or difficulty the student explicitly asked for.
 */
function assertSupportedFilters(provider: QuestionProvider, query: QuestionQuery): void {
  if (query.topicSlug && !provider.capabilities.topics) {
    throw new QuestionProviderUnsupportedFilterError(
      `Provider "${provider.id}" cannot filter by topic (requested "${query.topicSlug}").`,
      "Topic-specific practice will be available with an expanded question source. Start an all-topics session instead.",
    );
  }

  if (query.difficulty && !provider.capabilities.difficulty) {
    throw new QuestionProviderUnsupportedFilterError(
      `Provider "${provider.id}" cannot filter by difficulty (requested "${query.difficulty}").`,
      "Difficulty selection will be available with an expanded question source. Start a mixed session instead.",
    );
  }

  if (query.year != null && !provider.capabilities.years) {
    throw new QuestionProviderUnsupportedFilterError(
      `Provider "${provider.id}" cannot filter by year (requested "${query.year}").`,
      "Year selection will be available with an expanded question source. Start an all-years session instead.",
    );
  }
}

export async function fetchCanonicalQuestions(
  query: QuestionQuery,
  providerId?: string,
): Promise<CanonicalQuestion[]> {
  const provider = getQuestionProvider(providerId);
  const validated = validateQuery(query);
  assertSupportedFilters(provider, validated);
  return provider.fetchQuestions(validated);
}

/**
 * Safe for a student-facing route. It intentionally strips the answer key and
 * explanation before the payload leaves the server boundary.
 */
export async function fetchStudentQuestions(
  query: QuestionQuery,
  providerId?: string,
): Promise<StudentQuestion[]> {
  const questions = await fetchCanonicalQuestions(query, providerId);
  return toStudentQuestions(questions);
}

/** Filters the Practice UI may offer. Deliberately excludes provider identity. */
export interface PracticeFilterCapabilities {
  years: boolean;
  topics: boolean;
  difficulty: boolean;
}

/**
 * Safe capability metadata for a server component. It exposes only what the UI
 * needs to decide which controls to render — never the provider name, base URL
 * or credentials.
 */
export function getPracticeFilterCapabilities(providerId?: string): PracticeFilterCapabilities {
  const { years, topics, difficulty } = getQuestionProvider(providerId).capabilities;
  return { years, topics, difficulty };
}

/**
 * Whether the active provider can serve this subject at all. A provider that
 * does not declare `supportsSubject` covers the whole catalogue.
 *
 * The product uses this to avoid offering a subject that would only fail at
 * session creation — including a mapping deliberately held back for verification.
 */
export function isSubjectAvailable(
  examBody: ExamBody,
  subjectSlug: string,
  providerId?: string,
): boolean {
  const provider = getQuestionProvider(providerId);
  return provider.supportsSubject?.(examBody, subjectSlug) ?? true;
}

/** Subject slugs the active provider cannot serve, for UI gating. */
export function unavailableSubjectSlugs(
  examBody: ExamBody,
  subjectSlugs: string[],
  providerId?: string,
): string[] {
  return subjectSlugs.filter((slug) => !isSubjectAvailable(examBody, slug, providerId));
}
