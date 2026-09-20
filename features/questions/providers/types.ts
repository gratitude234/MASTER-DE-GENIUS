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

  /**
   * Optional. Whether this deployment holds the server credentials the provider
   * needs.
   *
   * Declared only by a provider that is reached through subject-level routing
   * rather than by the deployment choosing it: a routed subject is offered
   * automatically, so onboarding must not advertise it on a deployment where
   * attempting it would necessarily fail. It is a configuration check and must
   * stay synchronous and free of I/O — it runs on every catalogue render.
   *
   * Omitting it means "assume configured", which is how the ALOC adapters have
   * always behaved: a deployment that names one in `QUESTION_PROVIDER` and
   * forgets its key gets a loud session failure, not a silently empty catalogue.
   */
  isConfigured?(): boolean;
}
