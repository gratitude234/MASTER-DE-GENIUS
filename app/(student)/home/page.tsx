import Link from "next/link";
import { Compass } from "lucide-react";
import { ActiveExamCard } from "@/components/home/active-exam-card";
import { HomeHeader } from "@/components/home/home-header";
import { LatestMockCard, LatestMockEmptyCard } from "@/components/home/latest-mock-card";
import { MistakesCard } from "@/components/home/mistakes-card";
import { QuickActions } from "@/components/home/quick-actions";
import { RecommendedPracticeCard } from "@/components/home/recommended-practice-card";
import { SubjectPerformance } from "@/components/home/subject-performance";
import { WeakAreasCard } from "@/components/home/weak-areas-card";
import { EmptyState } from "@/components/ui/empty-state";
import { latestMockSummary, recommendPractice, WEAK_ACCURACY_THRESHOLD } from "@/features/home/recommendation";
import { getActiveExamAttemptSummaryForUser } from "@/features/exams/service";
import { getStudentProfile } from "@/features/profile/queries";
import { loadHistory } from "@/features/results/service";
import { mistakeBank } from "@/features/results/grading";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function HomePage() {
  const { user, profile, preference, examBody } = await getStudentProfile();
  // Expiry submission happens before reading history, so newly finished mocks appear immediately.
  const activeExam = await getActiveExamAttemptSummaryForUser(user.id, preference?.exam_body_id);
  const history = await loadHistory(user.id);

  const examBodyId = preference?.exam_body_id;
  const scoped = history.filter((result) => result.examBodyId === examBodyId);
  const recent = scoped[0];

  const recommendation = recommendPractice(history, examBodyId);
  const latestMock = latestMockSummary(history, examBodyId);
  const activeMistakes = mistakeBank(history).filter((mistake) => !mistake.mastered).length;

  const weakAreas = recent
    ? [...recent.topics]
        .filter((topic) => topic.topicSlug && topic.accuracy < WEAK_ACCURACY_THRESHOLD)
        .sort((a, b) => a.accuracy - b.accuracy || a.key.localeCompare(b.key))
        .slice(0, 3)
        .map((topic) => ({
          subject: recent.subjects.find((subject) => subject.subjectSlug === topic.subjectSlug)?.name ?? topic.subjectSlug,
          topic: topic.name,
          accuracy: topic.accuracy,
          correct: topic.correct,
          total: topic.total,
        }))
    : [];

  const firstName = profile.full_name.split(/\s+/).filter(Boolean)[0] || "Student";
  const examLabel = `${examBody?.short_name ?? "Exam"} ${preference?.exam_year ?? ""} Preparation`.replace(/\s+/g, " ").trim();

  return (
    <div className="screen-enter space-y-4">
      {/*
        Readiness and days-to-exam are deliberately not passed: there is no
        agreed readiness formula, and the student preference stores an exam year
        rather than a date. Both chips stay hidden until a real value exists.
      */}
      <HomeHeader name={firstName} examLabel={examLabel} />

      {activeExam ? <ActiveExamCard attempt={activeExam} /> : null}

      <RecommendedPracticeCard recommendation={recommendation} />

      <QuickActions examCode={examBody?.code ?? null} />

      {recent ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {latestMock ? (
              <LatestMockCard
                score={latestMock.score}
                maximum={latestMock.maximum}
                scaled={latestMock.scaled}
                delta={latestMock.delta}
                date={dateFormatter.format(new Date(latestMock.completedAt))}
                href={`/progress/results/exam/${latestMock.id}`}
              />
            ) : examBody?.code === "jamb" ? (
              <LatestMockEmptyCard />
            ) : null}
            <MistakesCard count={activeMistakes} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SubjectPerformance
              caption="Latest attempt"
              subjects={recent.subjects.map((subject) => ({
                name: subject.name,
                accuracy: subject.accuracy,
                correct: subject.correct,
                total: subject.total,
              }))}
            />
            {weakAreas.length > 0 ? (
              <WeakAreasCard areas={weakAreas} resultHref={`/progress/results/${recent.kind}/${recent.id}`} />
            ) : null}
          </div>
        </>
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

      <Link
        href="/offline"
        className="inline-flex min-h-11 items-center rounded text-xs font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        Saved sessions · Offline access →
      </Link>
    </div>
  );
}
