import { recommendClass } from "@/features/classes/recommendation";
import type { ClassRecommendation } from "@/features/classes/types";
import { WEAK_ACCURACY_THRESHOLD } from "@/features/home/recommendation";
import { summariseProgress, type SubjectAggregate } from "@/features/progress/summary";
import { mistakeBank, type LearningResult } from "@/features/results/grading";

export interface WeakTopic {
  subjectName: string;
  topicName: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface StudentAcademicSnapshot {
  practiceCount: number;
  mockCount: number;
  questions: number;
  accuracy: number | null;
  /** Accuracy across the five most recent completed results. */
  recentAccuracy: number | null;
  lastCompletedAt: string | null;
  subjects: SubjectAggregate[];
  weakTopics: WeakTopic[];
  activeMistakes: number;
  masteredMistakes: number;
  recommendation: ClassRecommendation | null;
}

/**
 * What an admin sees about a student's learning, computed from the same graded
 * results, Mistake Bank replay, weak-area threshold and class recommendation
 * the student's own Progress and Classes pages use. Nothing is re-marked and no
 * readiness or projected score is invented.
 */
export function summariseStudentAcademics(history: LearningResult[], examBodyId?: string | null): StudentAcademicSnapshot {
  const ordered = [...history].sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id));
  const progress = summariseProgress(ordered);
  const recent = ordered.slice(0, 5);
  const recentQuestions = recent.reduce((sum, result) => sum + result.total, 0);
  const recentCorrect = recent.reduce((sum, result) => sum + result.correct, 0);

  // Topics are aggregated inside one exam body, like the class recommendation,
  // so a WAEC topic is never reported under a JAMB workspace.
  const scopeId = examBodyId ?? ordered[0]?.examBodyId;
  const topics = new Map<string, { subjectName: string; topicName: string; correct: number; total: number }>();
  for (const result of ordered) {
    if (scopeId && result.examBodyId !== scopeId) continue;
    for (const row of result.topics) {
      if (!row.topicSlug) continue;
      const key = `${row.subjectSlug}:${row.topicSlug}`;
      const current = topics.get(key) ?? {
        subjectName: result.subjects.find((subject) => subject.subjectSlug === row.subjectSlug)?.name ?? row.subjectSlug,
        topicName: row.name,
        correct: 0,
        total: 0,
      };
      current.correct += row.correct;
      current.total += row.total;
      topics.set(key, current);
    }
  }

  const weakTopics = [...topics.values()]
    .filter((row) => row.total >= 3)
    .map((row) => ({ ...row, accuracy: Math.round((100 * row.correct) / row.total) }))
    .filter((row) => row.accuracy < WEAK_ACCURACY_THRESHOLD)
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total || a.topicName.localeCompare(b.topicName))
    .slice(0, 8);

  const mistakes = mistakeBank(ordered);

  return {
    practiceCount: ordered.filter((result) => result.kind === "practice").length,
    mockCount: ordered.filter((result) => result.kind === "exam").length,
    questions: progress.questions,
    accuracy: progress.questions ? progress.accuracy : null,
    recentAccuracy: recentQuestions ? Math.round((100 * recentCorrect) / recentQuestions) : null,
    lastCompletedAt: ordered[0]?.completedAt ?? null,
    subjects: progress.subjects,
    weakTopics,
    activeMistakes: mistakes.filter((mistake) => !mistake.mastered).length,
    masteredMistakes: mistakes.filter((mistake) => mistake.mastered).length,
    recommendation: recommendClass(ordered, examBodyId),
  };
}
