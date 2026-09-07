import "server-only";

import { requireOnboardedUser } from "@/lib/auth";
import type { PracticeCatalogSubject, PracticeCatalogTopic } from "@/features/questions/types";

export async function getPracticeCatalog(): Promise<{
  examCode: string;
  examBodyId: string;
  examName: string;
  examYear: number;
  subjects: PracticeCatalogSubject[];
}> {
  const { supabase, user } = await requireOnboardedUser();

  const { data: preference, error: preferenceError } = await supabase
    .from("student_exam_preferences")
    .select("id, exam_body_id, exam_year")
    .eq("user_id", user.id)
    .eq("is_primary", true)
    .maybeSingle();

  if (preferenceError || !preference) {
    throw new Error("Your primary exam preference is not available.");
  }

  const [{ data: exam, error: examError }, { data: selected, error: selectedError }] = await Promise.all([
    supabase
      .from("exam_bodies")
      .select("code, short_name")
      .eq("id", preference.exam_body_id)
      .single(),
    supabase
      .from("student_subject_preferences")
      .select("subject_id, display_order")
      .eq("preference_id", preference.id)
      .order("display_order"),
  ]);

  if (examError || !exam) throw new Error("Could not load the selected exam.");
  if (selectedError) throw new Error("Could not load your selected subjects.");

  const subjectIds = (selected ?? []).map((item) => item.subject_id);
  const [{ data: subjectRows, error: subjectError }, { data: topicRows, error: topicError }, { data: examLinks, error: linksError }] = await Promise.all([
    subjectIds.length
      ? supabase.from("subjects").select("id, slug, name").in("id", subjectIds)
      : Promise.resolve({ data: [], error: null }),
    subjectIds.length
      ? supabase
          .from("topics")
          .select("id, subject_id, slug, name, display_order")
          .in("subject_id", subjectIds)
          .eq("is_active", true)
          .order("display_order")
      : Promise.resolve({ data: [], error: null }),
    subjectIds.length
      ? supabase
          .from("exam_subjects")
          .select("subject_id, is_compulsory, display_order")
          .eq("exam_body_id", preference.exam_body_id)
          .in("subject_id", subjectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (subjectError) throw new Error("Could not load subject details.");
  if (topicError) throw new Error("Could not load topic details. Apply the M2 migrations first.");
  if (linksError) throw new Error("Could not load exam subject configuration.");

  const selectedOrder = new Map((selected ?? []).map((item) => [item.subject_id, item.display_order]));
  const linksBySubject = new Map((examLinks ?? []).map((link) => [link.subject_id, link]));
  const topicsBySubject = new Map<string, PracticeCatalogTopic[]>();

  for (const topic of topicRows ?? []) {
    const list = topicsBySubject.get(topic.subject_id) ?? [];
    list.push({
      id: topic.id,
      subjectId: topic.subject_id,
      slug: topic.slug,
      name: topic.name,
      displayOrder: topic.display_order,
    });
    topicsBySubject.set(topic.subject_id, list);
  }

  const subjects: PracticeCatalogSubject[] = (subjectRows ?? [])
    .map((subject) => ({
      id: subject.id,
      slug: subject.slug,
      name: subject.name,
      isCompulsory: linksBySubject.get(subject.id)?.is_compulsory ?? false,
      displayOrder: selectedOrder.get(subject.id) ?? 100,
      topics: topicsBySubject.get(subject.id) ?? [],
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return {
    examCode: exam.code,
    examBodyId: preference.exam_body_id,
    examName: exam.short_name,
    examYear: preference.exam_year,
    subjects,
  };
}
