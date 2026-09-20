import "server-only";

import { QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import type { QuestionProvider } from "@/features/questions/providers/types";
import type { CanonicalQuestion, ProviderCapabilities, QuestionQuery } from "@/features/questions/types";
import type { ExamBody } from "@/types/domain";

import { requireSdashConfig, sdashConfigured, sdashSandbox } from "./config";
import { isSdashExamSubjectMapped, sdashExamType, sdashSubject } from "./mapping";
import { normalizeSdashQuestion, type SdashDiscardReason } from "./normalize";
import { sdashRecords, sdashRequest, type SdashUsageRecorder } from "./transport";

/** Sdash V1 documents `limit` as 1–50. Staying inside it avoids silent truncation. */
export const SDASH_BATCH_LIMIT = 50;

/** Hard ceiling on upstream calls for one session. Prevents retry storms. */
export const SDASH_MAX_UPSTREAM_REQUESTS = 8;

/**
 * Sdash serves questions at random, so repeats are expected. Two rounds that
 * add nothing new means the usable pool is exhausted and further calls would
 * only spend credits to receive the same records again.
 */
const MAX_BARREN_ROUNDS = 2;

export class SdashQuestionProvider implements QuestionProvider {
  readonly id = "sdash" as const;

  constructor(
    private readonly fetchImpl?: typeof fetch,
    private readonly usageRecorder?: SdashUsageRecorder,
  ) {}

  /**
   * Read at call time rather than frozen at construction, because the year
   * capability depends on `SDASH_SANDBOX` and the registry builds this provider
   * once per process.
   *
   * `topics` and `difficulty` are false because V1 carries neither field, and
   * claiming otherwise would show a student unrelated questions under a filter
   * label. `years` is false on Sandbox: that plan answers each subject from a
   * single examination year, so offering year selection would be a promise the
   * credential cannot keep. `assets` is true — `image` is a documented field
   * this adapter normalizes — and `explanations` is true because V1 carries
   * `solution`.
   */
  get capabilities(): ProviderCapabilities {
    return {
      years: !sdashSandbox(),
      topics: false,
      difficulty: false,
      passages: true,
      assets: true,
      explanations: true,
    };
  }

  /** Availability gating: a deployment with no token must not advertise Sdash subjects. */
  isConfigured(): boolean {
    return sdashConfigured();
  }

  supportsSubject(examBody: ExamBody, subjectSlug: string): boolean {
    return isSdashExamSubjectMapped(examBody, subjectSlug);
  }

  async fetchQuestions(query: QuestionQuery): Promise<CanonicalQuestion[]> {
    // Defence in depth: the question service refuses an unsupported filter
    // before a session is created, but the provider must never silently drop
    // one either.
    if (query.topicSlug) {
      throw new QuestionProviderUnsupportedFilterError(
        `Sdash V1 cannot filter by topic (requested "${query.topicSlug}").`,
        "Topic-specific practice will be available with an expanded question source. Start an all-topics session instead.",
      );
    }
    if (query.difficulty) {
      throw new QuestionProviderUnsupportedFilterError(
        `Sdash V1 cannot filter by difficulty (requested "${query.difficulty}").`,
        "Difficulty selection will be available with an expanded question source. Start a mixed session instead.",
      );
    }

    const config = requireSdashConfig();
    if (query.year != null && config.sandbox) {
      throw new QuestionProviderUnsupportedFilterError(
        `Sdash Sandbox serves one examination year per subject, so year ${query.year} cannot be honoured.`,
        "Year selection will be available with an expanded question source. Start an all-years session instead.",
      );
    }

    const examType = sdashExamType(query.examBody);
    const subject = sdashSubject(query.examBody, query.subjectSlug);

    const context = {
      examBody: query.examBody,
      subjectSlug: query.subjectSlug,
      subjectName: subject.name,
      examType,
    };

    const seen = new Set<string>(query.excludeSourceIds ?? []);
    const collected: CanonicalQuestion[] = [];
    const discards = new Map<SdashDiscardReason, number>();

    let requests = 0;
    let barrenRounds = 0;
    let received = 0;

    while (
      collected.length < query.count &&
      requests < SDASH_MAX_UPSTREAM_REQUESTS &&
      barrenRounds < MAX_BARREN_ROUNDS
    ) {
      const remaining = query.count - collected.length;
      const limit = Math.min(remaining, SDASH_BATCH_LIMIT);
      const before = collected.length;

      const body = await sdashRequest({
        path: "/q",
        // The requested exam, subject and year are passed through untouched on
        // every round: a shortage is reported honestly, never papered over with
        // questions the student did not ask for.
        query: { subject: subject.sdash, type: examType, year: query.year ?? undefined, limit },
        examBody: query.examBody,
        subject: subject.sdash,
        requestType: query.requestType ?? "other",
        requestedQuestionCount: limit,
        config,
        fetchImpl: this.fetchImpl,
        usageRecorder: this.usageRecorder,
      });
      requests += 1;

      const records = sdashRecords(body);
      received += records.length;
      if (records.length === 0) break;                 // upstream has nothing more to give

      for (const record of records) {
        if (collected.length >= query.count) break;
        const { question, discarded } = normalizeSdashQuestion(record, context);
        if (discarded) {
          discards.set(discarded, (discards.get(discarded) ?? 0) + 1);
          continue;
        }
        if (!question) continue;

        const sourceId = question.source.providerQuestionId;
        if (seen.has(sourceId)) continue;              // excluded, blocked, or already collected
        seen.add(sourceId);
        collected.push(question);
      }

      barrenRounds = collected.length === before ? barrenRounds + 1 : 0;
    }

    const discardSummary = [...discards.entries()].map(([reason, count]) => `${reason}=${count}`).join(",") || "none";
    console.info(
      `[questions] provider=sdash exam=${examType} subject=${subject.sdash} requested=${query.count} ` +
        `requests=${requests} received=${received} unique=${collected.length} discarded=${discardSummary}`,
    );

    // Returning fewer than requested is intentional: the session engines own the
    // decision about an incomplete set, and a question is never duplicated or
    // substituted from another provider to pad a shortage.
    return collected;
  }
}
