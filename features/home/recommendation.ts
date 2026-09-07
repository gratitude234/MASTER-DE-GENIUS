import type { Breakdown, LearningResult, ResultKind } from "@/features/results/grading";

/**
 * At or above this accuracy a breakdown is not treated as a weak area. Matches
 * the threshold the results page already uses for "what should I do next?".
 */
export const WEAK_ACCURACY_THRESHOLD = 70;

export type PracticeRecommendation =
  | {
      kind: "topic";
      resultId: string;
      resultKind: ResultKind;
      subjectSlug: string;
      subjectName: string;
      topicSlug: string;
      topicName: string;
      accuracy: number;
      correct: number;
      total: number;
    }
  | {
      kind: "subject";
      resultId: string;
      resultKind: ResultKind;
      subjectSlug: string;
      subjectName: string;
      accuracy: number;
      correct: number;
      total: number;
    }
  /** Nothing to target. `hasHistory` separates a new student from a strong one. */
  | { kind: "start"; hasHistory: boolean };

/** Weakest first, then by key so equal accuracies never reorder between renders. */
function weakest<T extends Breakdown>(rows: T[]): T | undefined {
  return rows
    .filter((row) => row.accuracy < WEAK_ACCURACY_THRESHOLD)
    .sort((a, b) => a.accuracy - b.accuracy || a.key.localeCompare(b.key))[0];
}

/**
 * The one place that decides what a student should practise next.
 *
 * Reads only results that have already been loaded — it issues no queries and
 * owns no provider knowledge, so Practice Setup can call it with the same
 * history and reach the same answer. Nothing here is hardcoded to a subject.
 *
 * Order of preference: a weak topic in the most recent attempt, then a weak
 * subject in it, then an honest "start practising" with no weakness claimed.
 */
export function recommendPractice(
  history: LearningResult[],
  examBodyId?: string | null,
): PracticeRecommendation {
  const scoped = examBodyId ? history.filter((result) => result.examBodyId === examBodyId) : history;

  // Sorted here rather than trusted from the caller, so the recommendation is
  // the same whatever order the history arrives in.
  const recent = [...scoped].sort(
    (a, b) => b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id),
  )[0];

  if (!recent) return { kind: "start", hasHistory: false };

  const subjectName = (slug: string) =>
    recent.subjects.find((subject) => subject.subjectSlug === slug)?.name ?? slug;

  // Only categorised topics can be practised: a revision session needs a slug.
  const topic = weakest(recent.topics.filter((row) => row.topicSlug));
  if (topic) {
    return {
      kind: "topic",
      resultId: recent.id,
      resultKind: recent.kind,
      subjectSlug: topic.subjectSlug,
      subjectName: subjectName(topic.subjectSlug),
      topicSlug: topic.topicSlug as string,
      topicName: topic.name,
      accuracy: topic.accuracy,
      correct: topic.correct,
      total: topic.total,
    };
  }

  const subject = weakest(recent.subjects);
  if (subject) {
    return {
      kind: "subject",
      resultId: recent.id,
      resultKind: recent.kind,
      subjectSlug: subject.subjectSlug,
      subjectName: subject.name,
      accuracy: subject.accuracy,
      correct: subject.correct,
      total: subject.total,
    };
  }

  return { kind: "start", hasHistory: true };
}

/**
 * The most recent completed mock, with the change from the one before it.
 * `delta` is null when there is nothing to compare against — an unknown change
 * is not a change of zero.
 */
export function latestMockSummary(history: LearningResult[], examBodyId?: string | null) {
  const mocks = (examBodyId ? history.filter((result) => result.examBodyId === examBodyId) : history)
    .filter((result) => result.kind === "exam")
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id));

  const latest = mocks[0];
  if (!latest) return null;

  const previous = mocks[1];
  return {
    id: latest.id,
    score: latest.score,
    maximum: latest.maximum,
    scaled: latest.scaled,
    completedAt: latest.completedAt,
    delta: previous ? latest.score - previous.score : null,
  };
}
