import { PracticeSetup, type PracticeTab } from "@/components/practice/practice-setup";
import { recommendPractice, type PracticeRecommendation } from "@/features/home/recommendation";
import { getPracticeCatalog } from "@/features/questions/catalog";
import { getPracticeFilterCapabilities, unavailableSubjectSlugs } from "@/features/questions/service";
import { getLatestActivePracticeSessionForUser } from "@/features/practice/service";
import { loadHistory } from "@/features/results/service";
import { requireOnboardedUser } from "@/lib/auth";
import type { ExamBody } from "@/types/domain";

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; quick?: string }>;
}) {
  const params = await searchParams;
  const tab: PracticeTab = params.mode === "past" ? "past" : "practice";
  const prefillFromRecommendation = params.quick === "1";

  const { user } = await requireOnboardedUser();
  const [catalog, activeSession] = await Promise.all([
    getPracticeCatalog(),
    getLatestActivePracticeSessionForUser(user.id),
  ]);

  // Only the filters and subjects the active question source can actually serve
  // are offered, so a student is never sent into a session that cannot be built.
  const capabilities = getPracticeFilterCapabilities();
  const unavailableSubjects = unavailableSubjectSlugs(
    catalog.examCode as ExamBody,
    catalog.subjects.map((subject) => subject.slug),
  );

  /*
   * The same engine Home uses. Past Questions is browsed by year rather than by
   * weakness, so it does not read history at all — and `loadHistory` is heavy
   * enough to be worth skipping when nothing on screen consumes it.
   */
  let recommendation: PracticeRecommendation = { kind: "start", hasHistory: false };
  if (tab === "practice") {
    recommendation = recommendPractice(await loadHistory(user.id), catalog.examBodyId);
  }

  return (
    <PracticeSetup
      tab={tab}
      examName={catalog.examName}
      examYear={catalog.examYear}
      subjects={catalog.subjects}
      capabilities={capabilities}
      unavailableSubjects={unavailableSubjects}
      resumeSession={activeSession}
      recommendation={recommendation}
      prefillFromRecommendation={prefillFromRecommendation}
    />
  );
}
