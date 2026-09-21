/**
 * Where every "Upgrade to Master" goes, and how we learn which one was used.
 *
 * All of them land on the plan cards on /pricing — the page that actually sells
 * — never on Profile or Billing first. The `source` query names the prompt that
 * sent the student, from a fixed list, so the pricing page can attribute a
 * purchase journey without a single piece of personal information in the URL.
 *
 * Shared by server and client. Nothing here decides access.
 */

export const UPGRADE_SOURCES = [
  "nav",
  "nav_mobile",
  "dashboard",
  "practice_one_remaining",
  "practice_exhausted",
  "mock_one_remaining",
  "mock_exhausted",
  "ai_one_remaining",
  "ai_exhausted",
  "results",
  "mistakes",
  "me",
  "billing",
] as const;

export type UpgradeSource = (typeof UPGRADE_SOURCES)[number];

export const PLANS_PATH = "/pricing" as const;
/** The id of the plan-card section on /pricing. */
export const PLANS_ANCHOR = "plans" as const;

export const UPGRADE_CTA_LABEL = "Upgrade to Master" as const;

export function upgradeHref(source: UpgradeSource): string {
  return `${PLANS_PATH}?source=${source}#${PLANS_ANCHOR}`;
}

/** Anything not on the list is dropped, so a crafted URL cannot inject a value. */
export function parseUpgradeSource(value: unknown): UpgradeSource | null {
  return typeof value === "string" && (UPGRADE_SOURCES as readonly string[]).includes(value)
    ? (value as UpgradeSource)
    : null;
}
