import type { ResumeItem } from "@/components/home/resume-card";
import type { ActivePracticeSession } from "@/features/billing/usage-types";
import type { ActiveExamAttemptSummary } from "@/features/exams/types";

/**
 * Which piece of unfinished work the dashboard offers to resume.
 *
 * At most one. A student can have both a running mock and an unfinished
 * practice session, and showing two "Resume" cards at the top of the page asks
 * them to choose before they have read anything — so the order is decided here,
 * once, rather than by whichever card happens to render first.
 *
 * The mock wins. It is timed and it expires: leaving it costs the student a
 * mock attempt and a result. A practice session has no clock (or a generous
 * one), keeps its answers, and is still there afterwards.
 *
 * Pure. It takes what the page already loaded and returns markup-free data, so
 * the priority rule is directly testable without rendering anything.
 */
export function resumeItem(input: {
  activeExam: ActiveExamAttemptSummary | null;
  activePractice: ActivePracticeSession | null;
  /** Injected so the "time left" chip is deterministic in tests. */
  now?: number;
}): ResumeItem | null {
  const now = input.now ?? Date.now();

  if (input.activeExam) {
    const exam = input.activeExam;
    return {
      href: `/exam/${exam.id}`,
      eyebrow: "Exam in progress",
      title: `${exam.examName} Mock in progress`,
      facts: [
        `${exam.answeredCount}/${exam.totalQuestions} answered`,
        `${timeRemaining(exam.expiresAt, now)} left`,
      ],
      actionLabel: "Resume exam",
    };
  }

  if (input.activePractice) {
    const practice = input.activePractice;
    return {
      href: `/practice/session/${practice.id}`,
      eyebrow: "Practice in progress",
      title: `${practice.subjectName} practice in progress`,
      facts: [`${practice.answeredCount}/${practice.questionCount} answered`],
      actionLabel: "Resume session",
    };
  }

  return null;
}

/** "1h 16m" / "12m". Never "0m": under a minute still has time in it. */
function timeRemaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`;
}
