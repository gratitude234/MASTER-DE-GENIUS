import type { StudentQuestion } from "@/features/questions/types";
import type { AttemptStatus, ExamBody, QuestionOption } from "@/types/domain";

export type ExamSubmissionReason = "manual" | "time_expired";
export type ExamSaveState = "saved" | "saving" | "saved_local" | "syncing";

export interface MockExamSetupSubject {
  id: string;
  slug: string;
  name: string;
  displayOrder: number;
  questionCount: number;
  /** False when the active question source cannot serve this subject. */
  available: boolean;
}

export interface ActiveExamAttemptSummary {
  id: string;
  examName: string;
  status: AttemptStatus;
  answeredCount: number;
  flaggedCount: number;
  totalQuestions: number;
  startedAt: string;
  expiresAt: string;
}

export interface MockExamSetup {
  blueprintId: string;
  blueprintCode: string;
  blueprintName: string;
  examBodyId: string;
  examBody: ExamBody;
  examName: string;
  examYear: number;
  durationSeconds: number;
  totalQuestions: number;
  subjects: MockExamSetupSubject[];
  activeAttempt?: ActiveExamAttemptSummary | null;
}

export interface ExamAttemptQuestionView {
  revision: number;
  id: string;
  subjectId: string;
  subjectPosition: number;
  overallPosition: number;
  question: StudentQuestion;
  selectedOptionKey?: QuestionOption["key"] | null;
  isFlagged: boolean;
}

export interface ExamAttemptSubjectView {
  id: string;
  subjectId: string;
  slug: string;
  name: string;
  displayOrder: number;
  questionCount: number;
  answeredCount: number;
  flaggedCount: number;
  questions: ExamAttemptQuestionView[];
}

export interface ExamAttemptView {
  userId: string;
  serverNow: number;
  id: string;
  examBody: ExamBody;
  examName: string;
  blueprintName: string;
  examYear: number;
  status: AttemptStatus;
  sourceProvider: string;
  durationSeconds: number;
  totalQuestions: number;
  answeredCount: number;
  flaggedCount: number;
  startedAt: string;
  expiresAt: string;
  submittedAt?: string | null;
  submissionReason?: ExamSubmissionReason | null;
  subjects: ExamAttemptSubjectView[];
}

export interface CreateMockAttemptResult {
  attemptId: string;
  resumed: boolean;
  totalQuestions: number;
}

export interface SaveExamResponseResult {
  revision: number; mutationId: string; serverNow: number;
  selectedOptionKey: QuestionOption["key"] | null;
  isFlagged: boolean;
  answeredCount: number;
  flaggedCount: number;
  totalQuestions: number;
  expiresAt: string;
}

export interface SubmitExamAttemptResult {
  attemptId: string;
  status: "submitted";
  answeredCount: number;
  flaggedCount: number;
  totalQuestions: number;
  submittedAt: string;
  submissionReason: ExamSubmissionReason;
}
