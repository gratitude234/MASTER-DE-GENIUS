import { createClient } from "@/lib/supabase/server";
import type { OnboardingSubject } from "@/features/onboarding/types";

export async function getJambOnboardingCatalog() {
  const supabase = await createClient();
  const { data: jamb, error: examError } = await supabase
    .from("exam_bodies")
    .select("id, code, name, short_name, description")
    .eq("code", "jamb")
    .single();

  if (examError || !jamb) throw new Error("JAMB onboarding catalogue is not available. Apply the M1 migrations first.");

  const { data: links, error: linksError } = await supabase
    .from("exam_subjects")
    .select("subject_id, is_compulsory, display_order")
    .eq("exam_body_id", jamb.id)
    .order("display_order");

  if (linksError) throw new Error("Could not load JAMB subjects.");

  const subjectIds = (links ?? []).map((item) => item.subject_id);
  const { data: subjects, error: subjectsError } = subjectIds.length
    ? await supabase.from("subjects").select("id, slug, name").in("id", subjectIds)
    : { data: [], error: null };

  if (subjectsError) throw new Error("Could not load JAMB subjects.");

  const byId = new Map((subjects ?? []).map((subject) => [subject.id, subject]));
  const items: OnboardingSubject[] = (links ?? [])
    .map((link) => {
      const subject = byId.get(link.subject_id);
      if (!subject) return null;
      return {
        id: subject.id,
        slug: subject.slug,
        name: subject.name,
        isCompulsory: link.is_compulsory,
        displayOrder: link.display_order,
      };
    })
    .filter((item): item is OnboardingSubject => Boolean(item));

  return { exam: jamb, subjects: items };
}
