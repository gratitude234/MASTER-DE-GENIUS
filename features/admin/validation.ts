import { isAdminRole, type AdminRole } from "@/features/admin/permissions";

/**
 * Input checks for admin forms. The database functions enforce every rule
 * again; these exist so a mistake is explained next to the field before a
 * round trip, and so a malformed request never reaches a privileged call.
 */

export class AdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminInputError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPTION_KEYS = ["A", "B", "C", "D", "E"] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim() : "";
}

export function parseUuid(value: unknown, label = "record"): string {
  const id = text(value);
  if (!UUID.test(id)) throw new AdminInputError(`That ${label} could not be found.`);
  return id;
}

export function parseOptionalUuid(value: unknown, label = "record"): string | null {
  return value === null || value === undefined || value === "" ? null : parseUuid(value, label);
}

export function parseReason(value: unknown, { required = true }: { required?: boolean } = {}): string | null {
  const reason = text(value);
  if (!reason && !required) return null;
  if (reason.length < 5) throw new AdminInputError("Give a reason of at least 5 characters.");
  if (reason.length > 1000) throw new AdminInputError("Keep the reason under 1,000 characters.");
  return reason;
}

export function parseNote(value: unknown): string | null {
  const note = text(value);
  if (note.length > 5000) throw new AdminInputError("Keep notes under 5,000 characters.");
  return note || null;
}

export interface GrantInput {
  mode: "days" | "date";
  days?: number | string;
  expiresOn?: string;
  reason: string;
}

/** Either a duration or an explicit expiry, never both. A date means the end of that day in WAT. */
export function parseGrantInput(input: GrantInput, now: number = Date.now()): { days: number | null; expiresAt: string | null; reason: string } {
  const reason = parseReason(input.reason) as string;
  if (input.mode === "days") {
    const days = Number(input.days);
    if (!Number.isInteger(days) || days < 1 || days > 730) throw new AdminInputError("Choose between 1 and 730 days.");
    return { days, expiresAt: null, reason };
  }
  if (input.mode === "date") {
    const date = text(input.expiresOn);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00+01:00`))) {
      throw new AdminInputError("Choose a valid expiry date.");
    }
    const expiresAt = Date.parse(`${date}T00:00:00+01:00`) + 86_400_000;
    if (expiresAt <= now + 3_600_000) throw new AdminInputError("The expiry must be in the future.");
    return { days: null, expiresAt: new Date(expiresAt).toISOString(), reason };
  }
  throw new AdminInputError("Choose a duration or an expiry date.");
}

export interface QuestionInput {
  examBodyId: string;
  subjectId: string;
  topicId?: string | null;
  year?: string | number | null;
  difficulty?: string | null;
  questionText: string;
  explanation?: string | null;
  options: string[];
  correctOptionKey: string;
  status: string;
  reason?: string | null;
}

export interface QuestionPayload {
  exam_body_id: string;
  subject_id: string;
  topic_id: string | null;
  year: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
  question_text: string;
  explanation: string | null;
  correct_option_key: string;
  status: "draft" | "pending_review" | "active";
  options: { key: string; text: string }[];
}

export function parseQuestionInput(input: QuestionInput): { payload: QuestionPayload; reason: string | null } {
  const questionText = text(input.questionText);
  if (questionText.length < 3 || questionText.length > 5000) throw new AdminInputError("The question text must be between 3 and 5,000 characters.");

  const explanation = text(input.explanation);
  if (explanation.length > 5000) throw new AdminInputError("Keep the explanation under 5,000 characters.");

  const yearText = text(input.year == null ? "" : String(input.year));
  const year = yearText ? Number(yearText) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1960 || year > 2100)) throw new AdminInputError("The year must be between 1960 and 2100.");

  const difficulty = text(input.difficulty) || null;
  if (difficulty !== null && !["easy", "medium", "hard"].includes(difficulty)) throw new AdminInputError("Choose a valid difficulty.");

  const status = text(input.status);
  if (!["draft", "pending_review", "active"].includes(status)) throw new AdminInputError("Choose draft, pending review or active.");

  // Trailing empty option boxes are ignored; a gap in the middle is a mistake.
  const raw = (Array.isArray(input.options) ? input.options : []).map(text);
  while (raw.length && !raw[raw.length - 1]) raw.pop();
  if (raw.length < 2 || raw.length > 5) throw new AdminInputError("A question needs between two and five options.");
  if (raw.some((option) => !option)) throw new AdminInputError("Fill every option from A onwards, without gaps.");
  if (raw.some((option) => option.length > 2000)) throw new AdminInputError("Keep each option under 2,000 characters.");
  const options = raw.map((option, index) => ({ key: OPTION_KEYS[index], text: option }));

  const correct = text(input.correctOptionKey).toUpperCase();
  if (!options.some((option) => option.key === correct)) throw new AdminInputError("The correct answer must be one of the options.");

  return {
    payload: {
      exam_body_id: parseUuid(input.examBodyId, "exam"),
      subject_id: parseUuid(input.subjectId, "subject"),
      topic_id: parseOptionalUuid(input.topicId, "topic"),
      year,
      difficulty: difficulty as QuestionPayload["difficulty"],
      question_text: questionText,
      explanation: explanation || null,
      correct_option_key: correct,
      status: status as QuestionPayload["status"],
      options,
    },
    reason: parseReason(input.reason, { required: false }),
  };
}

export interface BlockInput {
  provider: string;
  exam: string;
  subject: string;
  sourceQuestionId: string;
  reason: string;
}

export function parseBlockInput(input: BlockInput) {
  const provider = text(input.provider).toLowerCase();
  const exam = text(input.exam).toLowerCase();
  const subject = text(input.subject).toLowerCase();
  const sourceQuestionId = text(input.sourceQuestionId);
  if (!/^[a-z_]{2,40}$/.test(provider)) throw new AdminInputError("Choose a question provider.");
  if (provider === "internal") throw new AdminInputError("Internal questions are disabled from the question bank, not blocked.");
  if (!/^[a-z_]{2,20}$/.test(exam)) throw new AdminInputError("Choose an exam.");
  if (!/^[a-z0-9-]+$/.test(subject)) throw new AdminInputError("Choose a subject.");
  if (!sourceQuestionId || sourceQuestionId.length > 200) throw new AdminInputError("Enter the provider's question id.");
  return { provider, exam, subject, sourceQuestionId, reason: parseReason(input.reason) as string };
}

export function parseMembershipEmail(value: unknown): string {
  const email = text(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AdminInputError("Enter the email address of an existing account.");
  return email;
}

export function parseRole(value: unknown): AdminRole {
  if (!isAdminRole(value)) throw new AdminInputError("Choose a role.");
  return value;
}

export function inputErrorMessage(error: unknown): string | null {
  return error instanceof AdminInputError ? error.message : null;
}
