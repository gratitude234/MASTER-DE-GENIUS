import { WEAK_ACCURACY_THRESHOLD } from "@/features/home/recommendation";
import { mistakeBank, type LearningResult } from "@/features/results/grading";
import type { ClassRecommendation } from "@/features/classes/types";

type Aggregate = { subjectSlug: string; subjectName: string; topicSlug: string | null; topicName: string | null; correct: number; total: number };

function examType(result: LearningResult): "jamb" | "waec" | null {
  return result.examCode === "jamb" || result.examCode === "waec" ? result.examCode : null;
}

export function recommendClass(history: LearningResult[], examBodyId?: string | null): ClassRecommendation | null {
  // Aggregation stays inside one exam body. Mixing them would let a WAEC topic
  // be recommended under a JAMB label whenever a student practises both.
  // Without an explicit preference, the most recent result chooses the body.
  const latest = examBodyId ? history.find((result) => result.examBodyId === examBodyId) : history[0];
  const exam = latest ? examType(latest) : null;
  if (!latest || !exam) return null;
  const scoped = history.filter((result) => result.examBodyId === latest.examBodyId);

  const repeated = new Map<string, { subjectSlug: string; subjectName: string; topicSlug: string; topicName: string; failures: number }>();
  for (const mistake of mistakeBank(scoped)) {
    const question = mistake.item.question;
    if (mistake.mastered || mistake.failures < 2 || !question.topic) continue;
    const key = `${question.subject.slug}:${question.topic.slug}`;
    const row = repeated.get(key) ?? { subjectSlug: question.subject.slug, subjectName: question.subject.name, topicSlug: question.topic.slug, topicName: question.topic.name, failures: 0 };
    row.failures += mistake.failures;
    repeated.set(key, row);
  }
  const repeatedWinner = [...repeated.values()].sort((a, b) => b.failures - a.failures || a.topicName.localeCompare(b.topicName))[0];
  if (repeatedWinner) {
    return {
      examType: exam,
      subjectSlug: repeatedWinner.subjectSlug,
      subjectName: repeatedWinner.subjectName,
      topic: repeatedWinner.topicName,
      topicSlug: repeatedWinner.topicSlug,
      accuracy: null,
      reason: "repeated_mistakes",
    };
  }

  const topics = new Map<string, Aggregate>();
  const subjects = new Map<string, Aggregate>();
  for (const result of scoped) {
    for (const row of result.topics) {
      if (!row.topicSlug) continue;
      const key = `${row.subjectSlug}:${row.topicSlug}`;
      const current = topics.get(key) ?? { subjectSlug: row.subjectSlug, subjectName: result.subjects.find((subject) => subject.subjectSlug === row.subjectSlug)?.name ?? row.subjectSlug, topicSlug: row.topicSlug, topicName: row.name, correct: 0, total: 0 };
      current.correct += row.correct; current.total += row.total; topics.set(key, current);
    }
    for (const row of result.subjects) {
      const current = subjects.get(row.subjectSlug) ?? { subjectSlug: row.subjectSlug, subjectName: row.name, topicSlug: null, topicName: null, correct: 0, total: 0 };
      current.correct += row.correct; current.total += row.total; subjects.set(row.subjectSlug, current);
    }
  }
  const weakest = (rows: Aggregate[]) => rows
    .filter((row) => row.total >= 3 && Math.round(100 * row.correct / row.total) < WEAK_ACCURACY_THRESHOLD)
    .sort((a, b) => (a.correct / a.total) - (b.correct / b.total) || b.total - a.total)[0];
  const topic = weakest([...topics.values()]);
  if (topic) return { examType: exam, subjectSlug: topic.subjectSlug, subjectName: topic.subjectName, topic: topic.topicName, topicSlug: topic.topicSlug, accuracy: Math.round(100 * topic.correct / topic.total), reason: "weak_topic" };
  const subject = weakest([...subjects.values()]);
  return subject ? { examType: exam, subjectSlug: subject.subjectSlug, subjectName: subject.subjectName, accuracy: Math.round(100 * subject.correct / subject.total), reason: "weak_subject" } : null;
}
