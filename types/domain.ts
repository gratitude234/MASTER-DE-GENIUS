export type ExamBody = "jamb" | "waec" | "neco" | "post_utme" | "school";

export type AttemptStatus =
  | "created"
  | "in_progress"
  | "submitted"
  | "expired"
  | "abandoned";

export type QuestionDifficulty = "easy" | "medium" | "hard";
export type QuestionStatus = "draft" | "pending_review" | "active" | "flagged" | "disabled";
export type QuestionKind = "single_choice";
export type QuestionAssetKind = "image" | "diagram" | "graph" | "table" | "map" | "illustration";

export interface Subject {
  id: string;
  examBody: ExamBody;
  name: string;
  slug: string;
  isCompulsory?: boolean;
}

export interface Topic {
  id: string;
  subjectId: string;
  name: string;
  slug: string;
}

export interface QuestionOption {
  id: string;
  key: "A" | "B" | "C" | "D" | "E";
  text: string;
}

export interface QuestionAsset {
  id: string;
  kind: QuestionAssetKind;
  url: string;
  altText?: string | null;
  caption?: string | null;
}

export interface Question {
  id: string;
  examBody: ExamBody;
  subjectId: string;
  topicId?: string | null;
  year?: number | null;
  prompt: string;
  passage?: string | null;
  assets?: QuestionAsset[];
  options: QuestionOption[];
  correctOptionKey: QuestionOption["key"];
  explanation?: string | null;
  difficulty?: QuestionDifficulty | null;
  status?: QuestionStatus;
  kind?: QuestionKind;
  sourceProvider?: string | null;
  sourceQuestionId?: string | null;
}

export interface ExamAttempt {
  id: string;
  userId: string;
  examBody: ExamBody;
  status: AttemptStatus;
  startedAt?: string | null;
  expiresAt?: string | null;
  submittedAt?: string | null;
  durationSeconds: number;
}

export interface AttemptAnswer {
  attemptId: string;
  questionId: string;
  selectedOptionKey?: QuestionOption["key"] | null;
  isFlagged: boolean;
  answeredAt?: string | null;
  updatedAt: string;
}
