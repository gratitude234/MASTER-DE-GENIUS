import "server-only";

import type { CanonicalQuestion, StudentQuestion } from "@/features/questions/types";

export function toStudentQuestion(question: CanonicalQuestion): StudentQuestion {
  const { correctOptionKey: _correctOptionKey, explanation: _explanation, ...safe } = question;
  void _correctOptionKey;
  void _explanation;
  return safe;
}

export function toStudentQuestions(questions: CanonicalQuestion[]): StudentQuestion[] {
  return questions.map(toStudentQuestion);
}
