import type {
  ExamBody,
  QuestionAsset,
  QuestionDifficulty,
  QuestionOption,
  Topic,
} from "@/types/domain";

export type QuestionProviderId = "internal" | "aloc" | "aloc_station" | "sdash";

export type QuestionRequestType = "practice" | "mock" | "probe" | "other";

export interface QuestionSourceRef {
  provider: QuestionProviderId | string;
  providerQuestionId: string;
  internalQuestionId?: string | null;
}

export interface QuestionPassage {
  id: string;
  title?: string | null;
  body: string;
}

/**
 * The canonical server-side question shape. It contains the answer key and
 * explanation and must never be serialized directly to a student's browser.
 */
export interface CanonicalQuestion {
  id: string;
  source: QuestionSourceRef;
  examBody: ExamBody;
  subject: {
    id: string;
    slug: string;
    name: string;
  };
  topic?: Topic | null;
  year?: number | null;
  prompt: string;
  passage?: QuestionPassage | null;
  assets: QuestionAsset[];
  options: QuestionOption[];
  correctOptionKey: QuestionOption["key"];
  explanation?: string | null;
  difficulty?: QuestionDifficulty | null;
}

/** Student-safe delivery payload. Answer keys and explanations are omitted. */
export type StudentQuestion = Omit<
  CanonicalQuestion,
  "correctOptionKey" | "explanation"
>;

export interface QuestionQuery {
  examBody: ExamBody;
  subjectSlug: string;
  topicSlug?: string | null;
  year?: number | null;
  difficulty?: QuestionDifficulty | null;
  count: number;
  excludeSourceIds?: string[];
  /** Server-side usage attribution. Never contains student identity. */
  requestType?: QuestionRequestType;
}

export interface ProviderCapabilities {
  years: boolean;
  topics: boolean;
  difficulty: boolean;
  passages: boolean;
  assets: boolean;
  explanations: boolean;
}

export interface PracticeCatalogTopic {
  id: string;
  slug: string;
  name: string;
  subjectId: string;
  displayOrder: number;
}

export interface PracticeCatalogSubject {
  id: string;
  slug: string;
  name: string;
  isCompulsory: boolean;
  displayOrder: number;
  topics: PracticeCatalogTopic[];
}
