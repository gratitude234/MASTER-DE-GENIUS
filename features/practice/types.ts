import type { StudentQuestion } from "@/features/questions/types";
import type { QuestionDifficulty, QuestionOption } from "@/types/domain";

/**
 * A timed practice session allows one minute per question. Defined here rather
 * than in the service so the setup screen can state the real limit before a
 * student commits, and the two can never drift apart.
 */
export const TIMED_SECONDS_PER_QUESTION = 60;

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
  /**
   * Null while correctness must stay hidden — an in-progress timed session.
   * Null means "not available yet", never a score of zero.
   */
  correctCount: number | null;
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
