import type { ExamAttemptView } from "@/features/exams/types";
import type { PracticeSessionView, PracticeFeedback } from "@/features/practice/types";
import type { QuestionOption } from "@/types/domain";
export type SessionKind = "exam" | "practice";
export interface Selection { selectedOptionKey: QuestionOption["key"] | null; isFlagged: boolean }
export interface PendingSelection extends Selection { mutationId: string; expectedRevision: number }
export interface SavedSelection extends Selection { revision: number; feedback?: PracticeFeedback }
export interface OfflineRecord {
  key: string; userId: string; kind: SessionKind; id: string;
  view: ExamAttemptView | PracticeSessionView;
  answers: Record<string, SavedSelection>;
  pending: Record<string, PendingSelection>;
  cursor: { subject: number; question: number };
  serverTime: number; wallTime: number;
  final: boolean;
  version: 1;
}
export const recordKey = (userId: string, kind: SessionKind, id: string) => `${userId}:${kind}:${id}`;
