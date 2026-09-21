/**
 * Stand-in for features/billing/usage.ts in page-level render tests.
 *
 * A test sets `globalThis.__usage` to the server summary it wants the page to
 * receive. When unset, the page renders as for an active Master student, whose
 * screens carry no Free-plan prompts — so tests written before the Free plan
 * existed keep asserting exactly what they always did.
 */

const RESET = "2026-09-21T23:00:00.000Z";

export const MASTER_USAGE = {
  tier: "master",
  isMaster: true,
  masterUntil: "2026-12-31T00:00:00.000Z",
  practice: { unit: "session", limit: 200, used: 0, remaining: 200, waiting: null, available: null, resetAt: RESET, window: "day" },
  mocks: { limit: 3, used: 0, remaining: 3, resetAt: RESET, window: "day" },
  aiExplanations: { limit: 20, used: 0, remaining: 20, resetAt: RESET, window: "day" },
};

export function freeUsage({ practice = {}, mocks = {}, ai = {} } = {}) {
  const p = { used: 0, waiting: 0, ...practice };
  const m = { used: 0, ...mocks };
  const a = { used: 0, ...ai };
  return {
    tier: "free",
    isMaster: false,
    masterUntil: null,
    practice: {
      unit: "question", limit: 4, used: p.used, remaining: p.remaining ?? 4 - p.used,
      waiting: p.waiting, available: p.available ?? Math.max(0, 4 - p.used - p.waiting), resetAt: RESET, window: "day",
    },
    mocks: { limit: 2, used: m.used, remaining: m.remaining ?? 2 - m.used, resetAt: "2026-09-30T23:00:00.000Z", window: "month" },
    aiExplanations: { limit: 2, used: a.used, remaining: a.remaining ?? 2 - a.used, resetAt: RESET, window: "day" },
  };
}

export async function getUsageSummary() {
  return globalThis.__usage ?? MASTER_USAGE;
}

export async function getPlanBadge() {
  const usage = globalThis.__usage ?? MASTER_USAGE;
  return { tier: usage.tier, masterUntil: usage.masterUntil };
}
