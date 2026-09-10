import {
  CLASS_LEAD_SOURCES,
  CLASS_TYPES,
  type ClassLeadInput,
  type PreferredContactMethod,
  type RecommendationReason,
} from "@/features/classes/types";

const CONTACT_METHODS = new Set<PreferredContactMethod>(["whatsapp", "phone", "email"]);
const REASONS = new Set<RecommendationReason>(["weak_topic", "weak_subject", "repeated_mistakes", "student_requested"]);

function string(value: unknown, max: number, required = false) {
  const result = typeof value === "string" ? value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") : "";
  if (required && !result) throw new Error("Please complete all required fields.");
  if (result.length > max) throw new Error("One of your answers is too long.");
  return result;
}

export function normalisePhone(value: string) {
  return value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

export function parseClassLeadInput(value: unknown): ClassLeadInput {
  if (!value || typeof value !== "object") throw new Error("Invalid class request.");
  const body = value as Record<string, unknown>;
  const studentName = string(body.studentName, 120, true);
  const email = string(body.email, 254);
  const phone = normalisePhone(string(body.phone, 30, true));
  const examType = string(body.examType, 10);
  const subjectSlug = string(body.subjectSlug, 100, true);
  const subjectName = string(body.subjectName, 120, true);
  const topic = string(body.topic, 160);
  const classType = string(body.classType, 30);
  const preferredContactMethod = string(body.preferredContactMethod, 20) as PreferredContactMethod;
  const preferredSchedule = string(body.preferredSchedule, 300, true);
  const message = string(body.message, 1500);
  const source = string(body.source, 40);
  const recommendationReason = string(body.recommendationReason, 40) as RecommendationReason;
  const recentAccuracy = body.recentAccuracy == null || body.recentAccuracy === "" ? null : Number(body.recentAccuracy);

  if (!/^\+?\d{10,15}$/.test(phone)) throw new Error("Enter a valid WhatsApp or phone number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (preferredContactMethod === "email" && !email) throw new Error("Add an email address or choose another contact method.");
  if (body.promotionalEmailConsent === true && !email) throw new Error("Add an email address to receive email updates.");
  if (examType !== "jamb" && examType !== "waec") throw new Error("Choose JAMB or WAEC.");
  if (!/^[a-z0-9-]+$/.test(subjectSlug)) throw new Error("Choose a valid subject.");
  if (!CLASS_TYPES.includes(classType as ClassLeadInput["classType"])) throw new Error("Choose a valid class type.");
  if (!CONTACT_METHODS.has(preferredContactMethod)) throw new Error("Choose a valid contact method.");
  if (!CLASS_LEAD_SOURCES.includes(source as ClassLeadInput["source"])) throw new Error("Invalid request source.");
  if (!REASONS.has(recommendationReason)) throw new Error("Invalid recommendation context.");
  if (recentAccuracy != null && (!Number.isInteger(recentAccuracy) || recentAccuracy < 0 || recentAccuracy > 100)) {
    throw new Error("Invalid performance context.");
  }

  return {
    studentName,
    email: email || null,
    phone,
    examType,
    subjectSlug,
    subjectName,
    topic: topic || null,
    classType: classType as ClassLeadInput["classType"],
    preferredContactMethod,
    preferredSchedule,
    message: message || null,
    source: source as ClassLeadInput["source"],
    recommendationReason,
    recentAccuracy,
    promotionalWhatsappConsent: body.promotionalWhatsappConsent === true,
    promotionalEmailConsent: body.promotionalEmailConsent === true,
  };
}
