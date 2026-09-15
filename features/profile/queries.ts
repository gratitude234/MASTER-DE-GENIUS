import { resolveActiveExamContext } from "@/features/exam-context/service";
import { requireOnboardedUser } from "@/lib/auth";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getStudentProfile(explicitCode?: string) {
  const { supabase, user, profile } = await requireOnboardedUser();

  const preference = await resolveActiveExamContext(supabase, user.id, explicitCode);
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

export async function getStudentExamLabel(supabase: ServerClient, userId: string) {
 const preference = await resolveActiveExamContext(supabase, userId);
 return { shortName: preference.exam.short_name, year: preference.exam_year };
}
