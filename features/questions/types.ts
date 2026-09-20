import type { QuestionContextKind } from "@/features/questions/context";
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
  /**
   * What this context actually is.
   *
   * `"passage"` is prose the student must read and is what the UI labels
   * "Passage". `"given"` is legitimate non-prose material the question needs —
   * a formula, a table, a set of values — which is shown in the same block
   * under a neutral label, because calling a formula a passage is what let a
   * flattened MathML equation onto the screen as though it were an extract.
   *
   * Optional and absent from every snapshot frozen before this existed, which
   * read as `"passage"` and render exactly as they always did.
   */
  kind?: QuestionContextKind;
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
  /**
   * Section-level instruction text — "Choose the option opposite in meaning to
   * the word given." It is deliberately separate from `passage`: an instruction
   * tells the student what to do, a passage is source material they must read.
   * Nothing about it is secret, so it travels into the student snapshot beside
   * the prompt it governs.
   */
  instruction?: string | null;
  prompt: string;
  passage?: QuestionPassage | null;
  /**
   * Context the adapter refused rather than showed — a worked solution, an
   * equation flattened out of MathML, material the prompt already carries.
   *
   * It exists so the integrity validator can say *why* a question lost its
   * context and the admin inspector can show it, and it carries no examination
   * content: only the classification and a short diagnostic phrase. The refused
   * text itself is dropped at the adapter and never travels.
   */
  discardedContext?: { kind: QuestionContextKind; detail?: string } | null;
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
