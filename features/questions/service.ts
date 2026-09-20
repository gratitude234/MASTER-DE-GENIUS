import "server-only";

import { blockedSourceIds, loadBlockedQuestions, withoutBlockedQuestions, type BlockedQuestion } from "@/features/questions/blocks";
import { toStudentQuestions } from "@/features/questions/delivery";
import { QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import { checkQuestionIntegrity, type QuestionIntegrityReason } from "@/features/questions/integrity";
import { getQuestionProvider } from "@/features/questions/providers";
import type { QuestionProvider } from "@/features/questions/providers/types";
import { resolveQuestionProviderId } from "@/features/questions/routing";
import type { CanonicalQuestion, QuestionQuery, StudentQuestion } from "@/features/questions/types";
import type { ExamBody } from "@/types/domain";

export { resolveQuestionProviderId } from "@/features/questions/routing";

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

/**
 * Replacement rounds allowed after the first fetch, when integrity validation
 * has removed candidates and the session is short.
 *
 * Three provider invocations in total. The bound matters because each one is
 * itself already bounded — legacy ALOC sends at most 8 upstream requests and
 * Station at most 12 — so the worst case is finite and small, and a provider
 * whose inventory is genuinely bad is never hammered. A round that produces no
 * new candidate at all ends the loop immediately, so an exhausted pool costs one
 * extra call rather than three.
 */
export const MAX_INTEGRITY_TOPUP_ROUNDS = 2;

/** One refused candidate. Contains no answer key and no student identity. */
export interface QuestionIntegrityRejection {
  provider: string;
  providerQuestionId: string;
  examBody: string;
  subjectSlug: string;
  reason: QuestionIntegrityReason;
  detail?: string;
}

export interface AssembledQuestions {
  questions: CanonicalQuestion[];
  rejections: QuestionIntegrityRejection[];
  /** Provider invocations spent. Asserted by tests to prove the bound holds. */
  rounds: number;
}

/**
 * Fetches, validates and — when validation removed something — tops up.
 *
 * A student who asked for 20 questions must receive 20 valid ones, not 17
 * because three provider records had lost their examination context. Each round
 * asks only for the shortfall and carries forward every source id already seen,
 * so a replacement is never a duplicate and a known-bad question is never
 * re-fetched. Admin blocks are applied to every round, not just the first.
 *
 * The requested filters (exam, subject, year, topic, difficulty) are passed
 * through untouched: a shortage is reported honestly rather than papered over
 * with questions the student did not ask for.
 *
 * Exported for tests, which inject a provider directly.
 */
export async function assembleDeliverableQuestions(
  provider: QuestionProvider,
  query: QuestionQuery,
  blocked: BlockedQuestion[] = [],
): Promise<AssembledQuestions> {
  const seen = new Set<string>([
    ...(query.excludeSourceIds ?? []),
    ...blockedSourceIds(blocked, provider.id),
  ]);
  const questions: CanonicalQuestion[] = [];
  const rejections: QuestionIntegrityRejection[] = [];
  let rounds = 0;

  while (questions.length < query.count && rounds <= MAX_INTEGRITY_TOPUP_ROUNDS) {
    const batch = await provider.fetchQuestions({
      ...query,
      count: query.count - questions.length,
      excludeSourceIds: [...seen],
    });
    rounds += 1;

    let fresh = 0;
    // The final word on blocks: a provider that ignored its exclusion list still
    // cannot put a blocked question into a session.
    for (const candidate of withoutBlockedQuestions(batch, blocked)) {
      if (questions.length >= query.count) break;
      const sourceId = candidate.source.providerQuestionId;
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      fresh += 1;

      const verdict = checkQuestionIntegrity(candidate);
      if (!verdict.valid) {
        rejections.push({
          provider: String(candidate.source.provider),
          providerQuestionId: sourceId,
          examBody: query.examBody,
          subjectSlug: query.subjectSlug,
          reason: verdict.reason!,
          detail: verdict.detail,
        });
        continue;
      }
      questions.push(candidate);
    }

    // Nothing new arrived: the usable pool is exhausted and further rounds would
    // only spend provider credits to receive the same records again.
    if (fresh === 0) break;
  }

  return { questions, rejections, rounds };
}

/**
 * One aggregated line per assembly, and only when something was refused.
 *
 * Deliberately not one log per question: bad inventory arrives in runs, and the
 * per-batch summary is the shape the provider adapters already use. It records
 * provider, provider question id, exam, subject and reason — never an answer
 * key, an explanation or anything identifying a student.
 */
function reportIntegrityRejections(providerId: string, query: QuestionQuery, result: AssembledQuestions): void {
  if (result.rejections.length === 0) return;

  const counts = new Map<QuestionIntegrityReason, number>();
  for (const rejection of result.rejections) {
    counts.set(rejection.reason, (counts.get(rejection.reason) ?? 0) + 1);
  }
  const reasons = [...counts.entries()].map(([reason, count]) => `${reason}=${count}`).join(",");
  const ids = result.rejections.slice(0, 20).map((rejection) => rejection.providerQuestionId).join(" ");

  console.warn(
    `[questions] integrity provider=${providerId} exam=${query.examBody} subject=${query.subjectSlug} ` +
      `requested=${query.count} delivered=${result.questions.length} rejected=${result.rejections.length} ` +
      `rounds=${result.rounds} reasons=${reasons} ids=${ids}`,
  );
}

/**
 * The one place a provider instance is chosen for a request.
 *
 * `providerId` is an explicit override — tests, the admin diagnostics panel and
 * the probe scripts pass one deliberately. Left out, the exam and subject decide
 * through the verified routing table, falling back to the deployment's global
 * `QUESTION_PROVIDER`. A session therefore uses exactly one provider for the
 * whole subject: there is no fallback between providers, and a top-up round asks
 * the same provider again.
 */
function resolveProvider(
  examBody: ExamBody,
  subjectSlug: string,
  providerId?: string,
): QuestionProvider {
  return getQuestionProvider(resolveQuestionProviderId(examBody, subjectSlug, providerId));
}

export async function fetchCanonicalQuestions(
  query: QuestionQuery,
  providerId?: string,
): Promise<CanonicalQuestion[]> {
  const provider = resolveProvider(query.examBody, query.subjectSlug, providerId);
  const validated = validateQuery(query);
  assertSupportedFilters(provider, validated);

  // Admin-blocked external questions are skipped here, the single entry point
  // both session engines share, so neither engine needed to change. Integrity
  // validation lives here for the same reason: Practice and Mock get identical
  // protection without either engine knowing this rule exists.
  const blocked = await loadBlockedQuestions(validated.examBody, validated.subjectSlug);
  const assembled = await assembleDeliverableQuestions(provider, validated, blocked);
  reportIntegrityRejections(provider.id, validated, assembled);
  return assembled.questions;
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
 *
 * Without an exam and subject this answers for the deployment's global provider,
 * which is what it always meant and what the admin panel still wants.
 */
export function getPracticeFilterCapabilities(providerId?: string): PracticeFilterCapabilities {
  const { years, topics, difficulty } = getQuestionProvider(providerId).capabilities;
  return { years, topics, difficulty };
}

/**
 * Capabilities per subject, because they are no longer a property of the
 * deployment.
 *
 * WAEC Mathematics is served by ALOC Station, which can filter by year; WAEC
 * Physics is served by Sdash, which on a Sandbox credential cannot. Offering one
 * year control for the whole screen would either hide a filter that works or
 * advertise one that does not, and a filter the resolved provider cannot honour
 * must fail before a session is frozen rather than be quietly dropped.
 *
 * `fallback` is the global provider's answer, used for a subject the caller did
 * not ask about.
 */
export interface PracticeSubjectCapabilities {
  fallback: PracticeFilterCapabilities;
  bySubject: Record<string, PracticeFilterCapabilities>;
}

export function getPracticeFilterCapabilitiesBySubject(
  examBody: ExamBody,
  subjectSlugs: string[],
): PracticeSubjectCapabilities {
  const bySubject: Record<string, PracticeFilterCapabilities> = {};
  for (const slug of subjectSlugs) {
    const { years, topics, difficulty } = resolveProvider(examBody, slug).capabilities;
    bySubject[slug] = { years, topics, difficulty };
  }
  return { fallback: getPracticeFilterCapabilities(), bySubject };
}

/**
 * Whether the provider resolved for this exam and subject can serve it at all.
 *
 * Two independent conditions, both required:
 *
 *   - the provider maps the subject (`supportsSubject`; omitting it means the
 *     whole catalogue), and
 *   - the deployment holds its credentials (`isConfigured`; omitting it means
 *     "assume configured", preserving how the ALOC adapters have always behaved).
 *
 * The second matters because a routed subject is offered without anyone choosing
 * its provider: on a deployment with no `SDASH_API_KEY` the four Sdash-backed
 * WAEC subjects would otherwise be advertised and then fail at session creation.
 * Both checks are pure lookups — no network call happens on a catalogue render.
 */
export function isSubjectAvailable(
  examBody: ExamBody,
  subjectSlug: string,
  providerId?: string,
): boolean {
  const provider = resolveProvider(examBody, subjectSlug, providerId);
  if (provider.isConfigured?.() === false) return false;
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
