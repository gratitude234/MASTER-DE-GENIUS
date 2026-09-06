import type { StudentQuestion } from "@/features/questions/types";
import type { QuestionDifficulty, QuestionOption } from "@/types/domain";

export type PracticeMode = "practice" | "timed";
export type PracticeSessionStatus = "in_progress" | "completed" | "expired" | "abandoned";
export type PracticeSaveState = "saved" | "saving" | "saved_local" | "syncing";

export interface CreatePracticeSessionInput {
  subjectSlug: string;
  topicSlug?: string | null;
  count: number;
  mode: PracticeMode;
  difficulty?: QuestionDifficulty | null;
  year?: number | null;
}

export interface PracticeFeedback {
  isCorrect: boolean;
  correctOptionKey: QuestionOption["key"];
  explanation?: string | null;
}

export interface PracticeSessionQuestionView {
  revision: number;
  id: string;
  position: number;
  question: StudentQuestion;
  selectedOptionKey?: QuestionOption["key"] | null;
  feedback?: PracticeFeedback | null;
}

export interface PracticeSessionView {
  userId: string;
  serverNow: number;
  id: string;
  mode: PracticeMode;
  status: PracticeSessionStatus;
  subjectName: string;
  subjectSlug: string;
  topicName?: string | null;
  topicSlug?: string | null;
  difficulty?: QuestionDifficulty | null;
  year?: number | null;
  requestedCount: number;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  sourceProvider: string;
  startedAt: string;
  expiresAt?: string | null;
  completedAt?: string | null;
  questions: PracticeSessionQuestionView[];
}

export interface SavePracticeAnswerResult {
  revision: number; mutationId: string; serverNow: number;
  isFlagged: boolean;
  selectedOptionKey: QuestionOption["key"];
  answeredCount: number;
  questionCount: number;
  feedback?: PracticeFeedback;
}

export interface CompletePracticeSessionResult {
  sessionId: string;
  status: "completed";
  answeredCount: number;
  correctCount: number;
  questionCount: number;
  completedAt: string;
}
