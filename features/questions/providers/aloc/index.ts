import "server-only";

import { QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import type { QuestionProvider } from "@/features/questions/providers/types";
import type { CanonicalQuestion, ProviderCapabilities, QuestionQuery } from "@/features/questions/types";
import type { ExamBody } from "@/types/domain";

import { alocExamType, alocSubject, isMappedSubject } from "./mapping";
import { normalizeAlocQuestion, type DiscardReason } from "./normalize";
import { alocRequest, envelopeRecords, requireAlocConfig, type AlocConfig } from "./transport";

/**
 * The legacy `/q/{n}` endpoint caps how many questions one response may carry,
 * so larger sessions (a 60-question English paper) are assembled from several
 * bounded calls rather than one oversized request.
 */
export const ALOC_BATCH_LIMIT = 40;

/** Hard ceiling on upstream calls for a single session. Prevents retry storms. */
export const MAX_UPSTREAM_REQUESTS = 8;

/**
 * ALOC returns randomly selected questions, so repeats are expected. Two rounds
 * that add nothing new means the usable pool is exhausted and further calls
 * would only burn quota.
 */
const MAX_BARREN_ROUNDS = 2;

export class AlocQuestionProvider implements QuestionProvider {
  readonly id = "aloc" as const;

  /**
   * Deliberately conservative. `topics` and `difficulty` are false because the
   * legacy API cannot filter on them, and claiming otherwise would show a
   * student unrelated questions under a filter label. `assets` and
   * `explanations` are false because neither could be confirmed against a live
   * response during M7; the normalizer still passes both through when a payload
   * happens to contain them, so the product under-promises rather than over-promises.
   */
  readonly capabilities: ProviderCapabilities = {
    years: true,
    topics: false,
    difficulty: false,
    passages: true,
    assets: false,
    explanations: false,
  };

  constructor(private readonly fetchImpl?: typeof fetch) {}

  /**
   * ALOC covers only part of the JAMB catalogue, and a mapping held back for
   * verification counts as unsupported. The product uses this to avoid offering
   * a subject that would fail at session creation.
   */
  supportsSubject(examBody: ExamBody, subjectSlug: string): boolean {
    return examBody === "jamb" && isMappedSubject(subjectSlug);
  }

  async fetchQuestions(query: QuestionQuery): Promise<CanonicalQuestion[]> {
    const examType = alocExamType(query.examBody);
    const subject = alocSubject(query.subjectSlug);

    // Defence in depth: the question service refuses unsupported filters before
    // a session is created, but the provider must never silently drop one.
    if (query.topicSlug) {
      throw new QuestionProviderUnsupportedFilterError(
        `ALOC cannot filter by topic (requested "${query.topicSlug}").`,
        "Topic-specific practice will be available with an expanded question source. Start an all-topics session instead.",
      );
    }
    if (query.difficulty) {
      throw new QuestionProviderUnsupportedFilterError(
        `ALOC cannot filter by difficulty (requested "${query.difficulty}").`,
        "Difficulty selection will be available with an expanded question source. Start a mixed session instead.",
      );
    }

    const config = requireAlocConfig();
    const context = {
      examBody: query.examBody,
      subjectSlug: query.subjectSlug,
      subjectName: subject.name,
    };

    const seen = new Set<string>(query.excludeSourceIds ?? []);
    const collected: CanonicalQuestion[] = [];
    const discards = new Map<DiscardReason, number>();

    let requests = 0;
    let barrenRounds = 0;
    let received = 0;

    while (collected.length < query.count && requests < MAX_UPSTREAM_REQUESTS && barrenRounds < MAX_BARREN_ROUNDS) {
      const remaining = query.count - collected.length;
      const batchSize = Math.min(remaining, ALOC_BATCH_LIMIT);
      const before = collected.length;

      const body = await this.request(config, batchSize, subject.aloc, examType, query.year ?? undefined);
      requests += 1;

      const records = envelopeRecords(body);
      received += records.length;
      if (records.length === 0) break;                 // upstream has nothing more to give

      for (const record of records) {
        if (collected.length >= query.count) break;
        const { question, discarded } = normalizeAlocQuestion(record, context);
        if (discarded) {
          discards.set(discarded, (discards.get(discarded) ?? 0) + 1);
          continue;
        }
        if (!question) continue;

        const sourceId = question.source.providerQuestionId;
        if (seen.has(sourceId)) continue;              // excluded, or already collected
        seen.add(sourceId);
        collected.push(question);
      }

      barrenRounds = collected.length === before ? barrenRounds + 1 : 0;
    }

    const discardSummary = [...discards.entries()].map(([reason, n]) => `${reason}=${n}`).join(",") || "none";
    console.info(
      `[questions] provider=aloc exam=${examType} subject=${subject.aloc} requested=${query.count} ` +
        `requests=${requests} received=${received} unique=${collected.length} discarded=${discardSummary}`,
    );

    // Returning fewer than requested is intentional: the exam engine owns the
    // decision to reject an incomplete paper, and questions are never duplicated
    // to pad a shortage.
    return collected;
  }

  private request(
    config: AlocConfig,
    batchSize: number,
    subject: string,
    examType: string,
    year?: number,
  ) {
    return alocRequest({
      path: batchSize > 1 ? `/q/${batchSize}` : "/q",
      query: { subject, type: examType, year },
      subject,
      examType,
      config,
      fetchImpl: this.fetchImpl,
    });
  }
}
