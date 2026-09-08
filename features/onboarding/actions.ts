"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import type { OnboardingActionState } from "@/features/onboarding/types";
import { EXAM_ONBOARDING_RULES, isOnboardingExamCode } from "@/features/onboarding/validation";
import type { Database } from "@/types/database";

export async function completeOnboardingAction(_previous: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const examYear = Number(formData.get("examYear"));
  const targetScore = Number(formData.get("targetScore"));
  const examCodeValue = String(formData.get("examCode") ?? "").trim();
  const intendedCourse = String(formData.get("intendedCourse") ?? "").trim();
  const studyIntensity = String(formData.get("studyIntensity") ?? "moderate") as Database["public"]["Enums"]["study_intensity"];
  const subjectIds = formData.getAll("subjectIds").filter((value): value is string => typeof value === "string" && value.length > 0);
  const currentYear = new Date().getFullYear();

  if (!isOnboardingExamCode(examCodeValue)) return { error: "Choose an available examination." };
  const rules = EXAM_ONBOARDING_RULES[examCodeValue];
  if (!Number.isInteger(examYear) || examYear < currentYear || examYear > currentYear + 4) return { error: `Choose a valid ${examCodeValue.toUpperCase()} exam year.` };
  if (!Number.isInteger(targetScore) || targetScore < rules.targetMin || targetScore > rules.targetMax) {
    return { error: examCodeValue === "waec" ? "Your percentage goal must be between 1 and 100." : "Your target score must be between 180 and 400." };
  }
  if (!(["light", "moderate", "intensive"] as string[]).includes(studyIntensity)) return { error: "Choose a valid study intensity." };
  const uniqueSubjectCount = new Set(subjectIds).size;
  if (uniqueSubjectCount !== subjectIds.length || uniqueSubjectCount < rules.minSubjects || uniqueSubjectCount > rules.maxSubjects) {
    return { error: examCodeValue === "jamb" ? "Select exactly four JAMB subjects." : "Select between one and nine WAEC preparation subjects." };
  }
  if (intendedCourse.length > 120) return { error: "Intended course is too long." };

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("complete_exam_onboarding", {
    p_exam_code: examCodeValue,
    p_exam_year: examYear,
    p_target_score: targetScore,
    p_intended_course: intendedCourse,
    p_study_intensity: studyIntensity,
    p_subject_ids: subjectIds,
  });

  if (error) return { error: error.message || "We couldn't save your preparation profile." };

  revalidatePath("/home");
  revalidatePath("/me");
  redirect("/home");
}
