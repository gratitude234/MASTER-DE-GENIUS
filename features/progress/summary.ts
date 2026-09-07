import type { LearningResult } from "@/features/results/grading";

export interface SubjectAggregate {
  slug: string;
  name: string;
  correct: number;
  total: number;
  accuracy: number;
  /** How many completed attempts contributed to this row. */
  attempts: number;
}

export interface ProgressSummary {
  attempts: number;
  questions: number;
  correct: number;
  accuracy: number;
  subjects: SubjectAggregate[];
}

/**
 * Totals across every completed attempt, for the Progress overview.
 *
 * Arithmetic on results that are already graded and already loaded — it runs no
 * query and re-marks nothing. Deliberately limited to counting: there is no
 * trend, no projection, no mastery or readiness score here, because none of
 * those has an agreed definition in the product yet.
 *
 * Rows are ordered by weakest accuracy first, then by name, so the ordering is
 * stable and the subject that needs work leads.
 */
export function summariseProgress(history: LearningResult[]): ProgressSummary {
  const subjects = new Map<string, SubjectAggregate>();
  let questions = 0;
  let correct = 0;

  for (const result of history) {
    questions += result.total;
    correct += result.correct;

    for (const subject of result.subjects) {
      const row = subjects.get(subject.subjectSlug) ?? {
        slug: subject.subjectSlug,
        name: subject.name,
        correct: 0,
        total: 0,
        accuracy: 0,
        attempts: 0,
      };
      row.correct += subject.correct;
      row.total += subject.total;
      row.attempts += 1;
      row.accuracy = row.total ? Math.round((100 * row.correct) / row.total) : 0;
      subjects.set(subject.subjectSlug, row);
    }
  }

  return {
    attempts: history.length,
    questions,
    correct,
    accuracy: questions ? Math.round((100 * correct) / questions) : 0,
    subjects: [...subjects.values()].sort((a, b) => a.accuracy - b.accuracy || a.name.localeCompare(b.name)),
  };
}
