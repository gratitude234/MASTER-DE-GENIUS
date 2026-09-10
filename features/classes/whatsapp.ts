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

export function studentClassMessage(subjectName?: string | null) {
  return subjectName
    ? `Hello Master De Genius, I would like information about your ${subjectName} classes.`
    : "Hello Master De Genius, I would like information about your Premium Classes.";
}

export function adminClassMessage(input: Pick<ClassLeadInput, "studentName" | "examType" | "subjectName">) {
  const firstName = input.studentName.split(/\s+/)[0] || "there";
  return `Hello ${firstName}, this is Master De Genius Academic Support. You recently requested help with ${input.examType.toUpperCase()} ${input.subjectName} on Master De Genius. I'm reaching out regarding your class request.`;
}
