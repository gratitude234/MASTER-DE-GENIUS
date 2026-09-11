import type { ClassLeadInput } from "@/features/classes/types";

export function supportWhatsappNumber() {
  const digits = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER?.replace(/\D/g, "") ?? "";
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export function whatsappUrl(message: string, number = supportWhatsappNumber()) {
  let digits = number?.replace(/\D/g, "") ?? "";
  // Student-entered Nigerian local numbers are stored in a familiar form but
  // wa.me requires international digits. Other international numbers pass through.
  if (/^0\d{10}$/.test(digits)) digits = `234${digits.slice(1)}`;
  if (!/^\d{10,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message.slice(0, 500))}`;
}

export function generalSupportMessage(kind: "academic" | "platform" | "general" = "general") {
  if (kind === "academic") return "Hello Master De Genius Academic Support. I have a question about my exam preparation.";
  if (kind === "platform") return "Hello Master De Genius, I need help with a platform or account issue.";
  return "Hello Master De Genius, I need some help.";
}

/** Short public reference shown to the student and on the admin lead card. */
export function leadReference(leadId: string) {
  return leadId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/**
 * Sent by the student after a request, so the enquiry reaches a channel the
 * business actually watches. It carries only the student's own first name,
 * the subject they asked about, and their own request reference.
 */
export function studentFollowUpMessage(input: { firstName: string; subjectName?: string | null; reference: string }) {
  const subject = input.subjectName ? `${input.subjectName} ` : "";
  return `Hello Master De Genius, this is ${input.firstName}. I just requested a ${subject}class on the app. My request reference is ${input.reference}.`;
}

export function adminClassMessage(input: Pick<ClassLeadInput, "studentName" | "examType" | "subjectName">) {
  const firstName = input.studentName.split(/\s+/)[0] || "there";
  return `Hello ${firstName}, this is Master De Genius Academic Support. You recently requested help with ${input.examType.toUpperCase()} ${input.subjectName} on Master De Genius. I'm reaching out regarding your class request.`;
}
