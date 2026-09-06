import type {
  CanonicalQuestion,
  ProviderCapabilities,
  QuestionProviderId,
  QuestionQuery,
} from "@/features/questions/types";
import type { ExamBody } from "@/types/domain";

export interface QuestionProvider {
  readonly id: QuestionProviderId;
  readonly capabilities: ProviderCapabilities;

  fetchQuestions(
    query: QuestionQuery
  ): Promise<CanonicalQuestion[]>;

  /**
   * Optional. A provider that covers only part of the subject catalogue declares
   * it here, so the product never offers a subject the active source cannot
   * serve. Omitting it means the provider serves the whole catalogue.
   */
  supportsSubject?(examBody: ExamBody, subjectSlug: string): boolean;
}
