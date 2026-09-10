export const CLASS_LEAD_SOURCES = [
  "class_page",
  "result",
  "progress",
  "mistake_bank",
  "topic_recommendation",
  "subject_recommendation",
  "persistent_support_cta",
  "public_classes_cta",
  "other",
] as const;

export type ClassLeadSource = (typeof CLASS_LEAD_SOURCES)[number];

export const CLASS_TYPES = [
  "group",
  "private",
  "topic_clinic",
  "jamb_bootcamp",
  "waec_bootcamp",
  "mock_review",
  "not_sure",
] as const;

export type ClassType = (typeof CLASS_TYPES)[number];
export type PreferredContactMethod = "whatsapp" | "phone" | "email";

/** Lifecycle order, and the single source for every status list in the UI and API. */
export const CLASS_LEAD_STATUSES = [
  "new",
  "contacted",
  "interested",
  "follow_up",
  "enrolled",
  "not_interested",
  "closed",
] as const;

export type ClassLeadStatus = (typeof CLASS_LEAD_STATUSES)[number];
export type RecommendationReason = "weak_topic" | "weak_subject" | "repeated_mistakes" | "student_requested";

export interface ClassRecommendation {
  examType: "jamb" | "waec";
  subjectSlug: string;
  subjectName: string;
  topic?: string | null;
  topicSlug?: string | null;
  accuracy?: number | null;
  reason: RecommendationReason;
}

export interface ClassLeadInput {
  studentName: string;
  email: string | null;
  phone: string;
  examType: "jamb" | "waec";
  subjectSlug: string;
  subjectName: string;
  topic: string | null;
  classType: ClassType;
  preferredContactMethod: PreferredContactMethod;
  preferredSchedule: string;
  message: string | null;
  source: ClassLeadSource;
  recommendationReason: RecommendationReason;
  recentAccuracy: number | null;
  promotionalWhatsappConsent: boolean;
  promotionalEmailConsent: boolean;
}

export const CLASS_TYPE_LABELS: Record<ClassType, string> = {
  group: "Group Class",
  private: "Private 1-on-1 Class",
  topic_clinic: "Topic Clinic",
  jamb_bootcamp: "JAMB Bootcamp",
  waec_bootcamp: "WAEC Bootcamp",
  mock_review: "Mock Review Class",
  not_sure: "Not Sure / Help Me Choose",
};

/** Internal CRM wording, for admin surfaces only. */
export const ADMIN_STATUS_LABELS: Record<ClassLeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  follow_up: "Follow Up",
  enrolled: "Enrolled",
  not_interested: "Not Interested",
  closed: "Closed",
};

export const STUDENT_STATUS_LABELS: Record<ClassLeadStatus, string> = {
  new: "We'll contact you",
  contacted: "Contacted",
  interested: "Next steps in progress",
  follow_up: "Follow-up planned",
  enrolled: "Enrolled",
  not_interested: "Not proceeding",
  closed: "Closed",
};
