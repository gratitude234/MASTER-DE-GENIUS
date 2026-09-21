/**
 * Every sentence a student reads about their allowance, written once.
 *
 * The routes return these in their 402 bodies and the components render them
 * from server-supplied counts, so a limit can never be described two different
 * ways — and no component carries its own "1", "20" or "2". The numbers always
 * come in as arguments, from the plan configuration or the server's usage
 * summary.
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

/**
 * What Practice offers right now, in the student's words.
 *
 * "1 practice session available today", not "1 of 1 quota remaining". A student
 * with one session a day is told what they can do, not what is left of a
 * counter — and a student on a plan with several is told how many.
 */
export function practiceAvailableLine(remaining: number): string {
  return `${countNoun(remaining, "practice session")} available today`;
}

/** The compact dashboard row when the day's session is already running. */
export const PRACTICE_SESSION_IN_PROGRESS_SHORT = "Session in progress" as const;

/** The compact dashboard row once the day's session has been used and finished. */
export const PRACTICE_SESSION_USED_SHORT = "Today’s session used" as const;

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

/**
 * Today's session exists and has not been finished.
 *
 * This is not a refusal the student should read as a loss: the session is
 * theirs, it is waiting, and finishing it costs nothing. Resume is the action;
 * Master is the offer beside it, never instead of it.
 */
export const PRACTICE_SESSION_IN_PROGRESS: AllowanceMessage = {
  message: "Today’s practice session is already in progress.",
  upgrade: "Upgrade to Master to start more practice sessions today.",
};

/** Today's session was created and there is nothing left to resume. */
export function practiceExhausted(limit: number): AllowanceMessage {
  return {
    message: limit === 1
      ? "You’ve used today’s free practice session."
      : `You’ve used today’s ${countNoun(limit, "free practice session")}.`,
    upgrade: "Upgrade to Master to start more practice sessions today.",
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

/**
 * "1 practice session a day, up to 20 questions" / "200 practice sessions a day,
 * up to 40 questions". The size is part of the offer, so it is part of the line.
 */
export function practiceAllowanceLabel(practice: { sessionsPerDay: number; maxQuestionsPerSession: number }): string {
  return `${countNoun(practice.sessionsPerDay, "practice session")} a day, up to ${countNoun(practice.maxQuestionsPerSession, "question")}`;
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
  practice: { sessionsPerDay: number; maxQuestionsPerSession: number };
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
