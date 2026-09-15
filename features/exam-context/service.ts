import "server-only";
import { cache } from "react";
import type { createClient } from "@/lib/supabase/server";
import { chooseExamPreference } from "./selection";

type Client = Awaited<ReturnType<typeof createClient>>;
export const getStudentExamPreferences = cache(async (db: Client, userId: string) => {
 const [preferences, exams] = await Promise.all([
  db.from("student_exam_preferences").select("*").eq("user_id", userId).eq("is_active", true).order("is_primary", { ascending: false }).order("exam_year", { ascending: false }),
  db.from("exam_bodies").select("id, code, short_name, name").eq("is_active", true).in("code", ["jamb", "waec"]),
 ]);
 if (preferences.error || exams.error) throw new Error("Could not load examination preferences.");
 return (preferences.data ?? []).flatMap(preference => {
  const exam = exams.data?.find(exam => exam.id === preference.exam_body_id);
  return exam ? [{ ...preference, exam }] : [];
 });
});
export async function resolveActiveExamContext(db: Client, userId: string, explicitCode?: string) {
 const preferences = await getStudentExamPreferences(db, userId);
 const { cookies } = await import("next/headers");
 const saved = (await cookies()).get("active-exam")?.value;
 const preference = chooseExamPreference(preferences, userId, saved, explicitCode);
 if (!preference) { const { redirect } = await import("next/navigation"); return redirect("/onboarding"); }
 return preference;
}
