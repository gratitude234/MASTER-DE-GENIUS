import { requireOnboardedUser } from "@/lib/auth";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getStudentProfile() {
  const { supabase, user, profile } = await requireOnboardedUser();

  const { data: preference } = await supabase
    .from("student_exam_preferences")
    .select("id, exam_body_id, exam_year, target_score, intended_course, study_intensity")
    .eq("user_id", user.id)
    .eq("is_primary", true)
    .maybeSingle();

  let examBody: { code: string; short_name: string; name: string } | null = null;
  let subjects: { id: string; name: string; slug: string }[] = [];

  if (preference) {
    const [{ data: exam }, { data: subjectLinks }] = await Promise.all([
      supabase.from("exam_bodies").select("code, short_name, name").eq("id", preference.exam_body_id).maybeSingle(),
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

/**
 * The sidebar's workspace badge, which needs the exam label and nothing else.
 *
 * Takes the caller's client and user id rather than re-authenticating: the
 * student layout has already resolved both, and a second `getUser()` on every
 * navigation would be a round trip for two columns. Returns null instead of
 * throwing — a missing preference should dim one badge, not fail every route.
 */
export async function getStudentExamLabel(
  supabase: ServerClient,
  userId: string,
): Promise<{ shortName: string; year: number } | null> {
  const { data: preference } = await supabase
    .from("student_exam_preferences")
    .select("exam_body_id, exam_year")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .maybeSingle();

  if (!preference) return null;

  const { data: exam } = await supabase
    .from("exam_bodies")
    .select("short_name")
    .eq("id", preference.exam_body_id)
    .maybeSingle();

  return exam?.short_name ? { shortName: exam.short_name, year: preference.exam_year } : null;
}
