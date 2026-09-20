/**
 * Which question provider serves a given exam and subject.
 *
 * MASTER shipped with exactly one provider per deployment, chosen by
 * `QUESTION_PROVIDER`. That is still the normal path and still the answer for
 * every subject below, but it cannot express the situation WAEC coverage
 * actually has: ALOC Station holds verified WAEC inventory for eleven subjects
 * and none at all for the sciences, while SdashAPI holds WASSCE Biology,
 * Chemistry, Physics and Agricultural Science.
 *
 * So one narrow layer sits above the global setting: a verified exam+subject
 * routing table. It is deliberately a small explicit map rather than a
 * capability negotiation — a subject appears here only after a live response
 * from the provider proved the mapping works, and nothing is ever inferred.
 *
 * This module is the single authority. Practice, Mock, onboarding and the
 * Practice filter gate all resolve through it, so provider selection cannot
 * drift between the screen that offers a subject and the service that builds
 * its session.
 *
 * Pure and synchronous: it reads configuration and a constant table, never the
 * network, so the same exam and subject always resolve the same way.
 */

import type { QuestionProviderId } from "@/features/questions/types";
import type { ExamBody } from "@/types/domain";

/** Used when `QUESTION_PROVIDER` is unset, exactly as the registry always did. */
export const FALLBACK_QUESTION_PROVIDER: QuestionProviderId = "internal";

/**
 * Verified exam+subject overrides.
 *
 * WAEC only, and only the four subjects whose SdashAPI `type=wassce` responses
 * were confirmed live (Biology 2018, Chemistry 2012, Physics 2025, Agriculture
 * 2025). JAMB is deliberately absent: its routing must not change, and Sdash
 * has no approved JAMB mapping in this milestone. NECO is absent for the same
 * reason.
 *
 * English Language and Further Mathematics are absent on purpose — see
 * `providers/sdash/mapping.ts`, which records why each is withheld.
 */
const VERIFIED_ROUTES: Partial<Record<ExamBody, Readonly<Record<string, QuestionProviderId>>>> = {
  waec: {
    biology: "sdash",
    chemistry: "sdash",
    physics: "sdash",
    "agricultural-science": "sdash",
  },
};

/** The deployment-wide provider. Preserved as the default for everything else. */
export function configuredQuestionProvider(): string {
  return process.env.QUESTION_PROVIDER?.trim() || FALLBACK_QUESTION_PROVIDER;
}

/**
 * The routed provider for this exam and subject, or null when no verified rule
 * applies and the global default should serve it.
 */
export function routedQuestionProvider(
  examBody: ExamBody,
  subjectSlug: string,
): QuestionProviderId | null {
  return VERIFIED_ROUTES[examBody]?.[subjectSlug] ?? null;
}

/**
 * Resolves the provider id for one exam and subject.
 *
 * Precedence, highest first:
 *
 *   1. an explicit override supplied by the caller — tests, the admin
 *      diagnostics panel and the provider probes pass one deliberately, and
 *      asking "what would ALOC Station do with WAEC Biology?" must keep
 *      answering honestly rather than being silently re-routed;
 *   2. a verified exam+subject rule;
 *   3. the global `QUESTION_PROVIDER`.
 *
 * Step 3 is why nothing changes for the existing catalogue: no rule matches
 * JAMB or the eleven established WAEC subjects, so they resolve exactly as they
 * did before this layer existed.
 */
export function resolveQuestionProviderId(
  examBody: ExamBody,
  subjectSlug: string,
  explicitProviderId?: string | null,
): string {
  const explicit = explicitProviderId?.trim();
  if (explicit) return explicit;
  return routedQuestionProvider(examBody, subjectSlug) ?? configuredQuestionProvider();
}

/** Exam+subject pairs with a verified override. Exposed for tests and admin. */
export function verifiedRouteEntries(): { examBody: ExamBody; subjectSlug: string; provider: QuestionProviderId }[] {
  return Object.entries(VERIFIED_ROUTES).flatMap(([examBody, subjects]) =>
    Object.entries(subjects ?? {}).map(([subjectSlug, provider]) => ({
      examBody: examBody as ExamBody,
      subjectSlug,
      provider,
    })),
  );
}
