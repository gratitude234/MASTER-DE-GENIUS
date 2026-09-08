import "server-only";

import { QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import type { QuestionProvider } from "@/features/questions/providers/types";
import type { CanonicalQuestion, ProviderCapabilities, QuestionQuery } from "@/features/questions/types";
import type { ExamBody } from "@/types/domain";

import { isStationExamSubjectMapped, stationExamType, stationSubject } from "./mapping";
import { normalizeStationQuestion, type StationDiscardReason } from "./normalize";
import { requireAlocStationConfig, stationRecords, stationRequest, type StationUsageRecorder } from "./transport";

// Station documents random retrieval as capped at ten results. Keeping each
// request within that contract prevents the provider silently truncating it.
export const STATION_RANDOM_BATCH_LIMIT = 10;
export const STATION_MAX_UPSTREAM_REQUESTS = 12;
const MAX_BARREN_ROUNDS = 2;

export class AlocStationQuestionProvider implements QuestionProvider {
  readonly id = "aloc_station" as const;
  readonly capabilities: ProviderCapabilities = {
    years: true,
    topics: false,
    difficulty: false,
    passages: true,
    assets: true,
    explanations: false,
  };

  constructor(
    private readonly fetchImpl?: typeof fetch,
    private readonly usageRecorder?: StationUsageRecorder,
  ) {}

  supportsSubject(examBody: ExamBody, subjectSlug: string): boolean {
    return isStationExamSubjectMapped(examBody, subjectSlug);
  }

  async fetchQuestions(query: QuestionQuery): Promise<CanonicalQuestion[]> {
    if (query.topicSlug || query.difficulty) {
      throw new QuestionProviderUnsupportedFilterError(
        "The initial ALOC Station L1 adapter does not enable paid metadata filters.",
        "Topic and difficulty filters are not available on the current question plan yet.",
      );
    }

    const examType = stationExamType(query.examBody);
    const subject = stationSubject(query.examBody, query.subjectSlug);
    const config = requireAlocStationConfig();
    const seen = new Set(query.excludeSourceIds ?? []);
    const collected: CanonicalQuestion[] = [];
    const discards = new Map<StationDiscardReason, number>();
    let requests = 0;
    let barrenRounds = 0;

    while (collected.length < query.count && requests < STATION_MAX_UPSTREAM_REQUESTS && barrenRounds < MAX_BARREN_ROUNDS) {
      const remaining = query.count - collected.length;
      const limit = Math.min(remaining, STATION_RANDOM_BATCH_LIMIT);
      const before = collected.length;
      const body = await stationRequest({
        path: "/questions",
        query: { subject: subject.station, examType, year: query.year ?? undefined, random: true, limit },
        examBody: examType,
        subject: subject.station,
        requestType: query.requestType ?? "other",
        requestedQuestionCount: limit,
        config,
        fetchImpl: this.fetchImpl,
        usageRecorder: this.usageRecorder,
      });
      requests += 1;

      const context = { examBody: query.examBody, subjectSlug: query.subjectSlug, subjectName: subject.name };
      for (const record of stationRecords(body)) {
        if (collected.length >= query.count) break;
        const normalized = normalizeStationQuestion(record, context);
        if (normalized.discarded) {
          discards.set(normalized.discarded, (discards.get(normalized.discarded) ?? 0) + 1);
          continue;
        }
        if (!normalized.question) continue;
        const sourceId = normalized.question.source.providerQuestionId;
        if (seen.has(sourceId)) continue;
        seen.add(sourceId);
        collected.push(normalized.question);
      }

      barrenRounds = collected.length === before ? barrenRounds + 1 : 0;
      if (stationRecords(body).length === 0) break;
    }

    const discarded = [...discards.entries()].map(([reason, count]) => `${reason}=${count}`).join(",") || "none";
    console.info(
      `[questions] provider=aloc_station exam=${examType} subject=${subject.station} requested=${query.count} ` +
      `requests=${requests} unique=${collected.length} discarded=${discarded}`,
    );
    return collected;
  }
}
