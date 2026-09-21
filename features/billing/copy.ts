/**
 * Every sentence a student reads about their allowance, written once.
 *
 * The routes return these in their 402 bodies and the components render them
 * from server-supplied counts, so a limit can never be described two different
 * ways — and no component carries its own "4" or "2". The numbers always come
 * in as arguments, from the plan configuration or the server's usage summary.
 *
 * Plain student language only: no "quota", "ledger", "reservation" or
 * "entitlement". Shared by server and client.
 */

/** "1 question" / "4 questions". */
export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ───────────────────────────────────────────────────────── remaining lines

/**
 * "3 of 4 questions remaining today" / "1 of 2 remaining this month".
 * The noun agrees with the limit, so "1 of 1 question" and "0 of 4 questions".
 */
export function remainingLine(
  remaining: number,
  limit: number,
  noun: string | null,
  window: "day" | "month",
): string {
  const of = noun ? countNoun(limit, noun) : String(limit);
  return `${remaining} of ${of} remaining ${window === "month" ? "this month" : "today"}`;
}

/** "3 of 4 practice questions remaining today" */
export function practiceRemainingLine(remaining: number, limit: number): string {
  return remainingLine(remaining, limit, "practice question", "day");
}

/** "1 of 2 free mocks remaining this month" */
export function mockRemainingLine(remaining: number, limit: number, window: "day" | "month" = "month"): string {
  return remainingLine(remaining, limit, "free mock", window);
}

/** "2 of 2 MASTER AI explanations remaining today" */
export function aiRemainingLine(remaining: number, limit: number): string {
  return remainingLine(remaining, limit, "MASTER AI explanation", "day");
}

// ─────────────────────────────────────────────── the conversion moments

export interface AllowanceMessage {
  /** What is true now. */
  message: string;
  /** What Master changes, and the reason to press the button. */
  upgrade: string;
}

export const PRACTICE_ONE_REMAINING = "You have 1 free practice question remaining today.";

export function practiceExhausted(limit: number): AllowanceMessage {
  return {
    message: `You’ve used today’s ${countNoun(limit, "free practice question")}.`,
    upgrade: "Upgrade to Master to keep practising today.",
  };
}

export const MOCK_ONE_REMAINING: AllowanceMessage = {
  message: "You have 1 free mock remaining this month.",
  upgrade: "Upgrade to Master to unlock more mocks and keep preparing without waiting.",
};

export function mockExhausted(limit: number): AllowanceMessage {
  return {
    message: `You’ve used your ${countNoun(limit, "free mock")} for this month.`,
    upgrade: "Upgrade to Master to continue taking mock exams now.",
  };
}

export const AI_ONE_REMAINING = "You have 1 MASTER AI explanation remaining today.";

export function aiExhausted(limit: number): AllowanceMessage {
  return {
    message: `You’ve used today’s ${countNoun(limit, "free MASTER AI explanation")}.`,
    upgrade: "Upgrade to Master for more explanations.",
  };
}

export const RESULTS_UPGRADE: AllowanceMessage = {
  message: "Want more practice on your weak areas?",
  upgrade: "Upgrade to Master for more practice, mocks and MASTER AI.",
};

// ───────────────────────────────────────────────── plan descriptions

/** "4 practice questions a day" / "200 practice sessions a day". */
export function practiceAllowanceLabel(practice: { unit: "question" | "session"; perDay: number }): string {
  return `${countNoun(practice.perDay, practice.unit === "question" ? "practice question" : "practice session")} a day`;
}

/** "2 full mocks a month" / "3 full mocks a day". */
export function mockAllowanceLabel(limits: { mockAttempts: number; mockAttemptWindow: "day" | "month" }): string {
  return `${countNoun(limits.mockAttempts, "full mock")} a ${limits.mockAttemptWindow}`;
}

/** "2 MASTER AI explanations a day". */
export function aiAllowanceLabel(perDay: number): string {
  return `${countNoun(perDay, "MASTER AI explanation")} a day`;
}

/** One line describing a whole plan's allowance, from the plan configuration. */
export function planAllowanceSummary(limits: {
  practice: { unit: "question" | "session"; perDay: number };
  mockAttempts: number;
  mockAttemptWindow: "day" | "month";
  aiExplanationsPerDay: number;
}): string {
  return `${practiceAllowanceLabel(limits.practice)}, ${mockAllowanceLabel(limits)} and ${aiAllowanceLabel(limits.aiExplanationsPerDay)}`;
}

// ───────────────────────────────────────────────────────────── resets

const monthDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Lagos" });

/** "at midnight (WAT)" / "on 1 October" — never a countdown. */
export function resetPhrase(resetAt: string | Date, window: "day" | "month"): string {
  if (window === "day") return "at midnight (WAT)";
  return `on ${monthDay.format(typeof resetAt === "string" ? new Date(resetAt) : resetAt)}`;
}

/** "Resets at midnight (WAT)." / "Resets on 1 October." */
export function resetLine(resetAt: string | Date, window: "day" | "month"): string {
  return `Resets ${resetPhrase(resetAt, window)}.`;
}
