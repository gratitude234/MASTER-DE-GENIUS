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
