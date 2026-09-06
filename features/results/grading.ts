import type { StudentQuestion } from "@/features/questions/types";

export type ResultKind = "exam" | "practice";
export type Outcome = "correct" | "incorrect" | "unanswered";
export interface ReviewItem {
  id: string;
  position: number;
  question: StudentQuestion;
  selected: string | null;
  correct: string;
  explanation: string | null;
  outcome: Outcome;
  flagged: boolean;
}
export interface Breakdown {
  key: string;
  name: string;
  subjectSlug: string;
  topicSlug: string | null;
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number;
}
export interface LearningResult {
  id: string;
  kind: ResultKind;
  examBodyId: string;
  title: string;
  completedAt: string;
  startedAt: string;
  elapsedSeconds: number;
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number;
  score: number;
  maximum: number;
  scaled: boolean;
  subjects: Breakdown[];
  topics: Breakdown[];
  items: ReviewItem[];
}
export function outcome(selected: string | null, correct: string): Outcome {
  return selected == null ? "unanswered" : selected === correct ? "correct" : "incorrect";
}
export function breakdown(items: ReviewItem[], byTopic: boolean): Breakdown[] {
  const groups = new Map<string, Breakdown>();
  for (const item of items) {
    const { subject, topic } = item.question;
    const key = JSON.stringify([subject.slug, byTopic ? topic?.slug ?? null : null]);
    const row = groups.get(key) ?? { key, name: byTopic ? topic?.name ?? "Uncategorised" : subject.name,
      subjectSlug: subject.slug, topicSlug: byTopic ? topic?.slug ?? null : null,
      total: 0, correct: 0, incorrect: 0, unanswered: 0, accuracy: 0 };
    row.total++;
    row[item.outcome]++;
    row.accuracy = Math.round(100 * row.correct / row.total);
    groups.set(key, row);
  }
  return [...groups.values()];
}
/** Version 1: one mark per question; each JAMB subject contributes 100 mock points. */
export function grade(items: ReviewItem[], jambMock: boolean) {
  const subjects = breakdown(items, false);
  const correct = items.filter(i => i.outcome === "correct").length;
  const unanswered = items.filter(i => i.outcome === "unanswered").length;
  const scaled = jambMock && subjects.length === 4;
  return { total: items.length, correct, unanswered, incorrect: items.length - correct - unanswered,
    accuracy: items.length ? Math.round(100 * correct / items.length) : 0,
    score: scaled ? Math.round(subjects.reduce((n, s) => n + 100 * s.correct / s.total, 0)) : correct,
    maximum: scaled ? 400 : items.length, scaled,
    subjects, topics: breakdown(items, true) };
}
export function questionIdentity(item: ReviewItem): string {
  const q = item.question;
  // Include exam and subject: external providers may reuse numeric IDs between subjects.
  return JSON.stringify([q.examBody, q.subject.slug, q.source.provider, q.source.providerQuestionId]);
}
export interface Mistake {
  key: string;
  item: ReviewItem;
  examBodyId: string;
  resultId: string;
  kind: ResultKind;
  lastSeen: string;
  failures: number;
  streak: number;
  mastered: boolean;
}
/** Replay immutable completions once each. Refresh cannot increment a mastery counter. */
export function mistakeBank(results: LearningResult[]): Mistake[] {
  const bank = new Map<string, Mistake>();
  const seenResults = new Set<string>();
  for (const result of [...results].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id))) {
    const resultKey = `${result.kind}:${result.id}`;
    if (seenResults.has(resultKey)) continue;
    seenResults.add(resultKey);
    const seenQuestions = new Set<string>();
    for (const item of result.items) {
      const key = questionIdentity(item);
      if (seenQuestions.has(key)) continue;
      seenQuestions.add(key);
      const previous = bank.get(key);
      if (!previous && item.outcome === "correct") continue;
      const streak = item.outcome === "correct" ? (previous?.streak ?? 0) + 1 : 0;
      bank.set(key, { key, item, examBodyId: result.examBodyId, resultId: result.id, kind: result.kind,
        lastSeen: result.completedAt, failures: (previous?.failures ?? 0) + (item.outcome === "correct" ? 0 : 1),
        streak, mastered: streak >= 2 });
    }
  }
  return [...bank.values()].sort((a, b) => Number(a.mastered) - Number(b.mastered) || b.lastSeen.localeCompare(a.lastSeen));
}
