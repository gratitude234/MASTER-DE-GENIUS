const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string) {
  if (!value) return "Email is required.";
  if (!emailPattern.test(value)) return "Enter a valid email address.";
  return null;
}

export function validatePassword(value: string) {
  if (!value) return "Password is required.";
  if (value.length < 8) return "Use at least 8 characters.";
  return null;
}

export function safeNextPath(value: FormDataEntryValue | null, fallback: string) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

/**
 * Advisory feedback for a password-confirmation pair, shown live as the student
 * types on signup and password reset.
 *
 * It never gates submission — `signupAction` and `updatePasswordAction` remain
 * the authority and re-check the pair server-side. The mismatch wording is kept
 * identical to theirs so the message cannot change on submit.
 */
export function passwordConfirmationFeedback(
  password: string,
  confirmation: string,
): { error?: string; success?: string } {
  if (confirmation.length === 0) return {};
  if (password !== confirmation) return { error: "Passwords do not match." };
  return { success: "Passwords match." };
}
