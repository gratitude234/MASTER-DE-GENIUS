import type { StudentQuestion } from "@/features/questions/types";
import type { QuestionOption } from "@/types/domain";

export type ExplanationTargetKind = "practice" | "exam";
export type ExplanationType = "explain_better" | "why_wrong";

export interface QuestionExplanation {
  summary: string;
  reasoning: string;
  whyStudentAnswerIsWrong: string | null;
  memoryTip: string | null;
}

export interface ExplanationRequest {
  targetKind: ExplanationTargetKind;
  sessionId: string;
  questionId: string;
  explanationType: ExplanationType;
}

export interface ExplanationResponse {
  explanation: QuestionExplanation;
  cached: boolean;
  remainingToday: number | null;
}

export interface VerifiedQuestionContext {
  question: StudentQuestion;
  correctOptionKey: QuestionOption["key"];
  selectedOptionKey: QuestionOption["key"];
  standardExplanation: string | null;
}

