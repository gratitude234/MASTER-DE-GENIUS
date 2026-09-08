import "server-only";

import type { OnboardingExam, OnboardingExamCode, OnboardingSelection, OnboardingSubject } from "@/features/onboarding/types";
import { isSubjectAvailable } from "@/features/questions/service";
import { createClient } from "@/lib/supabase/server";

const LIVE_EXAM_CODES = new Set<OnboardingExamCode>(["jamb", "waec"]);
const EXAM_ORDER: OnboardingExamCode[] = ["jamb", "waec"];

export async function getOnboardingCatalog(userId: string): Promise<{
  exams: OnboardingExam[];
  selection: OnboardingSelection;
}> {
  const supabase = await createClient();
  const { data: examRows, error: examError } = await supabase
    .from("exam_bodies")
    .select("id, code, name, short_name, description")
    .in("code", EXAM_ORDER)
    .eq("is_active", true);

  if (examError) throw new Error("The onboarding examination catalogue is not available. Apply the latest migrations first.");

  const exams = (examRows ?? []).filter(
    (exam): exam is typeof exam & { code: OnboardingExamCode } => LIVE_EXAM_CODES.has(exam.code as OnboardingExamCode),
  );
  const examIds = exams.map((exam) => exam.id);
  const { data: links, error: linksError } = examIds.length
    ? await supabase
        .from("exam_subjects")
        .select("exam_body_id, subject_id, is_compulsory, display_order")
        .in("exam_body_id", examIds)
        .order("display_order")
    : { data: [], error: null };

  if (linksError) throw new Error("Could not load examination subjects.");

  const subjectIds = [...new Set((links ?? []).map((item) => item.subject_id))];
  const { data: subjects, error: subjectsError } = subjectIds.length
    ? await supabase.from("subjects").select("id, slug, name").in("id", subjectIds).eq("is_active", true)
    : { data: [], error: null };

  if (subjectsError) throw new Error("Could not load examination subjects.");

  const subjectById = new Map((subjects ?? []).map((subject) => [subject.id, subject]));
  const catalog = EXAM_ORDER.flatMap((code) => {
    const exam = exams.find((candidate) => candidate.code === code);
    if (!exam) return [];
    const examSubjects: OnboardingSubject[] = (links ?? [])
      .filter((link) => link.exam_body_id === exam.id)
      .flatMap((link) => {
        const subject = subjectById.get(link.subject_id);
        if (!subject || !isSubjectAvailable(code, subject.slug)) return [];
        return [{
          id: subject.id, slug: subject.slug, name: subject.name,
          isCompulsory: link.is_compulsory, displayOrder: link.display_order,
        }];
      });

    const available = code === "jamb"
      ? examSubjects.length >= 4 && examSubjects.some((subject) => subject.slug === "use-of-english")
      : examSubjects.length > 0;

    /*
     * An exam body that is active in the database but has no serveable subject
     * is a deployment mistake, not a product decision — the active question
     * provider cannot map it. It used to fail silently: the card simply greyed
     * out, and the only way to notice was for someone to look at it. Saying so
     * once, server-side, makes it findable in the deployment log instead.
     */
    if (!available && links?.some((link) => link.exam_body_id === exam.id)) {
      console.warn(
        `[onboarding] ${code} is active but no subject is serveable by QUESTION_PROVIDER=${process.env.QUESTION_PROVIDER?.trim() || "internal"}`,
      );
    }

    return [{
      id: exam.id, code, name: exam.name, shortName: exam.short_name,
      description: exam.description, available, subjects: examSubjects,
    } satisfies OnboardingExam];
  });

  const { data: preference, error: preferenceError } = await supabase
    .from("student_exam_preferences")
    .select("id, exam_body_id, exam_year, target_score")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .maybeSingle();

  if (preferenceError) throw new Error("Could not load your current examination setup.");
  let selection: OnboardingSelection = null;
  if (preference) {
    const selectedExam = catalog.find((exam) => exam.id === preference.exam_body_id);
    if (selectedExam) {
      const { data: selectedSubjects, error: selectedError } = await supabase
        .from("student_subject_preferences")
        .select("subject_id, display_order")
        .eq("preference_id", preference.id)
        .order("display_order");
      if (selectedError) throw new Error("Could not load your current subjects.");
      selection = {
        examCode: selectedExam.code,
        examYear: preference.exam_year,
        targetScore: preference.target_score ?? (selectedExam.code === "jamb" ? 280 : 70),
        subjectIds: (selectedSubjects ?? []).map((item) => item.subject_id),
      };
    }
  }

  return { exams: catalog, selection };
}
