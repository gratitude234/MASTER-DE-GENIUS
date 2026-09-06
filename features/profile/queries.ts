import { requireOnboardedUser } from "@/lib/auth";

export async function getStudentProfile() {
  const { supabase, user, profile } = await requireOnboardedUser();

  const { data: preference } = await supabase
    .from("student_exam_preferences")
    .select("id, exam_body_id, exam_year, target_score, intended_course, study_intensity")
    .eq("user_id", user.id)
    .eq("is_primary", true)
    .maybeSingle();

  let examBody: { short_name: string; name: string } | null = null;
  let subjects: { id: string; name: string; slug: string }[] = [];

  if (preference) {
    const [{ data: exam }, { data: subjectLinks }] = await Promise.all([
      supabase.from("exam_bodies").select("short_name, name").eq("id", preference.exam_body_id).maybeSingle(),
      supabase.from("student_subject_preferences").select("subject_id, display_order").eq("preference_id", preference.id).order("display_order"),
    ]);
    examBody = exam;
    const ids = (subjectLinks ?? []).map((item) => item.subject_id);
    if (ids.length) {
      const { data: subjectRows } = await supabase.from("subjects").select("id, name, slug").in("id", ids);
      const byId = new Map((subjectRows ?? []).map((item) => [item.id, item]));
      subjects = ids.map((id) => byId.get(id)).filter((item): item is { id: string; name: string; slug: string } => Boolean(item));
    }
  }

  return { user, profile, preference, examBody, subjects };
}
