/**
 * Stand-in for features/billing/usage.ts in page-level render tests.
 *
 * A test sets `globalThis.__usage` to the server summary it wants the page to
 * receive. When unset, the page renders as for an active Master student, whose
 * screens carry no Free-plan prompts — so tests written before the Free plan
 * existed keep asserting exactly what they always did.
 *
 * The shape is the real one: practice is counted in **new sessions per day**,
 * and `activeSession` is what separates "in progress" from "used".
 */

const RESET = "2026-09-21T23:00:00.000Z";

export const MASTER_USAGE = {
  tier: "master",
  isMaster: true,
  masterUntil: "2026-12-31T00:00:00.000Z",
  practice: {
    limit: 200, used: 0, remaining: 200, resetAt: RESET, window: "day",
    maxQuestionsPerSession: 40, activeSession: null,
  },
  mocks: { limit: 3, used: 0, remaining: 3, resetAt: RESET, window: "day" },
  aiExplanations: { limit: 20, used: 0, remaining: 20, resetAt: RESET, window: "day" },
};

/**
 * A Free summary. `practice.used` drives `remaining`; pass `activeSession` to
 * describe a student who is part-way through today's session.
 */
export function freeUsage({ practice = {}, mocks = {}, ai = {} } = {}) {
  const p = { used: 0, activeSession: null, ...practice };
  const m = { used: 0, ...mocks };
  const a = { used: 0, ...ai };
  return {
    tier: "free",
    isMaster: false,
    masterUntil: null,
    practice: {
      limit: 1, used: p.used, remaining: p.remaining ?? Math.max(0, 1 - p.used),
      resetAt: RESET, window: "day",
      maxQuestionsPerSession: 20, activeSession: p.activeSession,
    },
    mocks: { limit: 2, used: m.used, remaining: m.remaining ?? 2 - m.used, resetAt: "2026-09-30T23:00:00.000Z", window: "month" },
    aiExplanations: { limit: 2, used: a.used, remaining: a.remaining ?? 2 - a.used, resetAt: RESET, window: "day" },
  };
}

/** A session the student has open, for the "in progress" states. */
export const ACTIVE_PRACTICE = {
  id: "session-1",
  subjectName: "Mathematics",
  answeredCount: 6,
  questionCount: 20,
};

export async function getUsageSummary() {
  return globalThis.__usage ?? MASTER_USAGE;
}

export async function getPlanBadge() {
  const usage = globalThis.__usage ?? MASTER_USAGE;
  return { tier: usage.tier, masterUntil: usage.masterUntil };
}
