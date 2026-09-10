import type { ClassLeadSource, RecommendationReason } from "@/features/classes/types";

export function classRequestHref(input: { source: ClassLeadSource; examType: string; subjectSlug: string; subjectName: string; topic?: string | null; reason?: RecommendationReason; accuracy?: number | null }) {
  const params = new URLSearchParams({ request: "1", source: input.source, examType: input.examType, subjectSlug: input.subjectSlug, subjectName: input.subjectName, recommendationReason: input.reason ?? "student_requested" });
  if (input.topic) params.set("topic", input.topic);
  if (input.accuracy != null) params.set("accuracy", String(input.accuracy));
  return `/classes?${params}`;
}
