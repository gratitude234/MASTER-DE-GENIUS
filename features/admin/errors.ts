/**
 * Plain-language messages for the codes the admin database functions raise.
 *
 * Codes are matched exactly. Anything unrecognised becomes a generic message:
 * a raw Postgres error can name tables and constraints, and is logged on the
 * server rather than shown in the browser.
 */
const MESSAGES: Record<string, string> = {
  ADMIN_PERMISSION_DENIED: "Your role does not allow this action.",
  ADMIN_REASON_REQUIRED: "Give a reason of at least 5 characters.",
  ADMIN_REASON_TOO_LONG: "Keep the reason under 1,000 characters.",
  ADMIN_SELF_MODIFICATION: "You cannot change your own access. Ask another super admin.",
  LAST_SUPER_ADMIN: "This would leave the platform without an active super admin.",
  ADMIN_TARGET_NOT_FOUND: "No Master De Genius account uses that email. The person must sign up first.",
  ADMIN_MEMBERSHIP_UNCHANGED: "That admin already has this role and status.",
  ADMIN_MEMBERSHIP_NOT_FOUND: "That admin membership no longer exists.",
  ADMIN_ROLE_REQUIRED: "Choose a role.",
  STUDENT_NOT_FOUND: "That student account no longer exists.",
  SUSPEND_ACTIVE_ADMIN: "Deactivate this person's admin access before suspending the account.",
  ACCOUNT_ALREADY_SUSPENDED: "This account is already suspended.",
  ACCOUNT_NOT_SUSPENDED: "This account is not suspended.",
  ENTITLEMENT_GRANT_SHAPE_INVALID: "Choose either a duration or an expiry date.",
  ENTITLEMENT_GRANT_DAYS_INVALID: "Choose between 1 and 730 days.",
  ENTITLEMENT_EXPIRY_NOT_FUTURE: "The expiry must be at least an hour from now.",
  ENTITLEMENT_EXPIRY_TOO_FAR: "The expiry cannot be more than three years away.",
  ENTITLEMENT_WOULD_SHORTEN: "That date is before the student's current Master expiry. Grants can only extend access.",
  CLASS_LEAD_NOT_FOUND: "That lead no longer exists.",
  ASSIGNEE_NOT_ELIGIBLE: "That admin cannot be assigned this work.",
  NOTE_TOO_LONG: "Keep notes under 5,000 characters.",
  NOTHING_TO_UPDATE: "Nothing changed.",
  SUPPORT_CASE_NOT_FOUND: "That support case no longer exists.",
  SUPPORT_STATUS_INVALID: "Choose a valid support status.",
  QUESTION_PAYLOAD_INVALID: "The question could not be read. Reload and try again.",
  QUESTION_STATUS_INVALID: "Choose draft, pending review or active.",
  QUESTION_TEXT_INVALID: "The question text must be between 3 and 5,000 characters.",
  QUESTION_EXPLANATION_INVALID: "Keep the explanation under 5,000 characters.",
  QUESTION_YEAR_INVALID: "The year must be between 1960 and 2100.",
  QUESTION_SUBJECT_NOT_IN_EXAM: "That subject is not offered for the selected exam.",
  QUESTION_TOPIC_INVALID: "That topic does not belong to the selected subject.",
  QUESTION_OPTIONS_INVALID: "A question needs between two and five options.",
  QUESTION_OPTION_KEYS_INVALID: "Options must run A, B, C… without gaps.",
  QUESTION_OPTION_TEXT_INVALID: "Every option needs text, up to 2,000 characters.",
  QUESTION_CORRECT_OPTION_INVALID: "The correct answer must be one of the options.",
  QUESTION_NOT_FOUND: "That question no longer exists.",
  QUESTION_PASSAGE_SUBJECT_LOCKED: "This question belongs to a passage, so its subject cannot change.",
  INTERNAL_QUESTIONS_USE_STATUS: "Internal questions are disabled from the question bank, not blocked.",
  QUESTION_ALREADY_BLOCKED: "That question is already blocked.",
  QUESTION_BLOCK_NOT_FOUND: "That block has already been lifted.",
  SESSION_NOT_FOUND: "That session no longer exists.",
  SESSION_NOT_OVERDUE: "Only a timed session whose time has already run out can be finalised.",
  INVALID_SESSION_KIND: "Unknown session type.",
  PAGINATION_INVALID: "That page is out of range.",
  STUDENT_FILTER_INVALID: "One of the filters is not recognised.",
  SESSION_FILTER_INVALID: "One of the filters is not recognised.",
  ACADEMIC_WINDOW_INVALID: "Choose a date range of up to one year.",
  EXAM_NOT_FOUND: "That exam is not recognised.",
  SUBJECT_NOT_FOUND: "That subject is not recognised.",
};

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message ?? "");
  return typeof error === "string" ? error : "";
}

export function adminErrorMessage(error: unknown, fallback = "The action could not be completed. Try again."): string {
  const text = messageOf(error).trim();
  if (MESSAGES[text]) return MESSAGES[text];
  if (/check constraint/i.test(text)) return "One of the values is not allowed.";
  return fallback;
}

export function isKnownAdminError(error: unknown): boolean {
  return Boolean(MESSAGES[messageOf(error).trim()]);
}
