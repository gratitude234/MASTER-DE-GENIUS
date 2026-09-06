import { PracticeSetup } from "@/components/practice/practice-setup";
import { getPracticeCatalog } from "@/features/questions/catalog";
import { getPracticeFilterCapabilities, unavailableSubjectSlugs } from "@/features/questions/service";
import { getLatestActivePracticeSessionForUser } from "@/features/practice/service";
import { requireOnboardedUser } from "@/lib/auth";
import type { ExamBody } from "@/types/domain";

export default async function PracticePage() {
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

  return (
    <PracticeSetup
      examName={catalog.examName}
      examYear={catalog.examYear}
      subjects={catalog.subjects}
      capabilities={capabilities}
      unavailableSubjects={unavailableSubjects}
      resumeSession={activeSession}
    />
  );
}
