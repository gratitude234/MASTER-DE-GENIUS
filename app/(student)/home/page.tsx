import { getStudentExamPreferences } from "@/features/exam-context/service";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Compass } from "lucide-react";
import { FreePlanCard } from "@/components/billing/free-plan-card";
import { getUsageSummary } from "@/features/billing/usage";
import { ContinueLearningCard, StartPracticeCard } from "@/components/home/continue-learning-card";
import { HomeHeader } from "@/components/home/home-header";
import { ProgressSummaryCard, type ProgressMetric } from "@/components/home/progress-summary-card";
import { QuickActions } from "@/components/home/quick-actions";
import { ResumeCard } from "@/components/home/resume-card";
import { EmptyState } from "@/components/ui/empty-state";
import { latestMockSummary, recommendPractice } from "@/features/home/recommendation";
import { resumeItem } from "@/features/home/resume";
import { getActiveExamAttemptSummaryForUser } from "@/features/exams/service";
import { getStudentProfile } from "@/features/profile/queries";
import { loadHistory } from "@/features/results/service";
import { mistakeBank } from "@/features/results/grading";
import { recommendClass } from "@/features/classes/recommendation";
import { ClassHelpCard } from "@/components/classes/class-help-card";

/**
 * The student dashboard, in priority order.
 *
 *   1. Header — who they are, their exam, and one plan control.
 *   2. Resume — unfinished work, if there is any. Above every suggestion.
 *   3. Continue learning — one personalised card, never a stack.
 *   4. Quick actions — Practice, Mock, Past Questions, Mistakes.
 *   5. Free plan usage — compact, three rows.
 *   6. Progress — latest mock, mistakes and subject accuracy in one card.
 *   7. Tutoring — last, and only when there is a real recommendation.
 *
 * The order is the point. This page used to open with an upgrade strip, an
 * upgrade banner and a full-width Free Plan panel before a student reached
 * their own unfinished exam, then spent four more cards on statistics. Reading
 * top to bottom now goes: what you were doing, what to do next, how to get
 * there, what your plan allows, how you are doing.
 *
 * Every count comes from `getUsageSummary` — the server's reservations — and
 * nothing on this page computes an allowance.
 */

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function HomePage() {
  const { user, profile, preference, examBody } = await getStudentProfile();
  // Expiry submission happens before reading history, so newly finished mocks appear immediately.
  const activeExam = await getActiveExamAttemptSummaryForUser(user.id, preference?.exam_body_id);
  const [history, usage] = await Promise.all([loadHistory(user.id), getUsageSummary(user.id)]);

  const preparations = await getStudentExamPreferences(await createClient(), user.id);
  const examBodyId = preference?.exam_body_id;
  const scoped = history.filter((result) => result.examBodyId === examBodyId);
  const recent = scoped[0];

  const recommendation = recommendPractice(history, examBodyId);
  const classRecommendation = recommendClass(history, examBodyId);
  const latestMock = latestMockSummary(history, examBodyId);
  const activeMistakes = mistakeBank(scoped).filter((mistake) => !mistake.mastered).length;

  /*
   * At most one thing to resume, chosen by one rule in one place. A student can
   * hold both a running mock and an unfinished practice session; two "Resume"
   * cards at the top of the page would make them choose before reading anything.
   */
  const resume = resumeItem({ activeExam, activePractice: usage.practice.activeSession });

  /*
   * One card for every measured number. A metric with no data is left out
   * rather than shown as a zero the student did not earn.
   */
  const progressMetrics: ProgressMetric[] = [];
  if (latestMock) {
    progressMetrics.push({
      key: "mock",
      label: "Latest mock",
      value: `${latestMock.score}/${latestMock.maximum}`,
      note: latestMock.scaled ? "Estimated JAMB score" : "Correct answers",
      href: `/progress/results/exam/${latestMock.id}`,
    });
  }
  if (activeMistakes > 0) {
    progressMetrics.push({
      key: "mistakes",
      label: "Mistakes to review",
      value: String(activeMistakes),
      href: "/progress/mistakes",
    });
  }
  // The weakest subject in the most recent attempt, not every subject: the full
  // per-subject breakdown lives on /progress, one tap away.
  const weakestSubject = recent
    ? [...recent.subjects].sort((a, b) => a.accuracy - b.accuracy || a.name.localeCompare(b.name))[0]
    : undefined;
  if (weakestSubject) {
    progressMetrics.push({
      key: "subject",
      label: weakestSubject.name,
      value: `${weakestSubject.correct}/${weakestSubject.total}`,
      note: recent ? `Latest attempt · ${dateFormatter.format(new Date(recent.completedAt))}` : undefined,
      href: `/progress/results/${recent!.kind}/${recent!.id}`,
    });
  }

  const firstName = profile.full_name.split(/\s+/).filter(Boolean)[0] || "Student";
  const examLabel = `${examBody?.short_name ?? "Exam"} ${preference?.exam_year ?? ""} Preparation`.replace(/\s+/g, " ").trim();

  return (
    <div className="screen-enter space-y-3.5">
      {/*
        Readiness and days-to-exam are deliberately not passed: there is no
        agreed readiness formula, and the student preference stores an exam year
        rather than a date. Both chips stay hidden until a real value exists.
      */}
      <HomeHeader name={firstName} examLabel={examLabel} tier={usage.tier} masterUntil={usage.masterUntil} />
      {preparations.length > 1 ? (
        <p className="text-[12.5px] text-slate-600">
          You’re preparing for {preparations.map((item) => item.exam.short_name).join(" & ")}. Showing{" "}
          {examBody?.short_name} progress.
        </p>
      ) : null}

      {/* 2 — unfinished work, above every suggestion the product might make. */}
      {resume ? <ResumeCard item={resume} /> : null}

      {/* 3 — one personalised card, or one cold-start line. Never both. */}
      {recommendation.kind === "start"
        ? recommendation.hasHistory ? null : <StartPracticeCard />
        : <ContinueLearningCard recommendation={recommendation} />}

      {/* 4 */}
      <QuickActions examCode={examBody?.code ?? null} />

      {/* 5 — Free only. Master sees its status in the header and nothing here. */}
      {usage.isMaster ? null : <FreePlanCard usage={usage} />}

      {/* 6 */}
      {progressMetrics.length > 0 ? (
        <ProgressSummaryCard metrics={progressMetrics} />
      ) : (
        /*
          Cold start. A brand-new student gets guidance in the space the
          analytics will occupy, rather than cards full of zeroes that read as
          measured performance.
        */
        <EmptyState
          icon={<Compass className="h-5 w-5" aria-hidden="true" />}
          title="Your progress will appear here"
          description="Finish a practice session and this space fills with your subject accuracy, the topics to work on next, and a mistake bank you can practise from."
          headingLevel={2}
        />
      )}

      {/* 7 — support, below everything a student studies with. */}
      {classRecommendation ? (
        <ClassHelpCard
          href={`/classes?${new URLSearchParams({ request: "1", source: classRecommendation.topic ? "topic_recommendation" : "subject_recommendation", examType: classRecommendation.examType, subjectSlug: classRecommendation.subjectSlug, subjectName: classRecommendation.subjectName, ...(classRecommendation.topic ? { topic: classRecommendation.topic } : {}), recommendationReason: classRecommendation.reason, ...(classRecommendation.accuracy != null ? { accuracy: String(classRecommendation.accuracy) } : {}) })}`}
          title={`A focused lesson on ${classRecommendation.topic ?? classRecommendation.subjectName} may help`}
          description="Practise independently, or ask a Master De Genius tutor to explain the ideas with you."
          label="Get Tutor Help"
        />
      ) : null}

      <Link
        href="/offline"
        className="inline-flex min-h-11 items-center rounded text-xs font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        Saved sessions · Offline access →
      </Link>
    </div>
  );
}
