import { formatNaira } from "@/features/billing/plans";

/**
 * Display formatting for the admin workspace. Admins operate in Nigeria, so
 * times are shown in West Africa Time rather than the server's UTC.
 */
const ADMIN_TIME_ZONE = "Africa/Lagos";

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: ADMIN_TIME_ZONE,
});
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: ADMIN_TIME_ZONE });
const shortDateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: ADMIN_TIME_ZONE });
const countFormat = new Intl.NumberFormat("en-NG");

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | null | undefined, empty = "—"): string {
  const date = parse(value);
  return date ? dateTimeFormat.format(date) : empty;
}

export function formatDate(value: string | null | undefined, empty = "—"): string {
  const date = parse(value);
  return date ? dateFormat.format(date) : empty;
}

export function formatShortDate(value: string | null | undefined, empty = "—"): string {
  const date = parse(value);
  return date ? shortDateFormat.format(date) : empty;
}

/** "3h ago", "12d ago". Past only — a future time is shown as a date. */
export function formatRelative(value: string | null | undefined, now: number = Date.now(), empty = "Never"): string {
  const date = parse(value);
  if (!date) return empty;
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 0) return formatDate(value);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86_400 * 60) return `${Math.floor(seconds / 86_400)}d ago`;
  return formatDate(value);
}

export function formatCount(value: number | string | null | undefined): string {
  const number = Number(value ?? 0);
  return countFormat.format(Number.isFinite(number) ? number : 0);
}

/**
 * Money is stored in kobo everywhere — Paystack's smallest unit — and only
 * becomes naira here, through the same formatter the pricing page uses.
 */
export function formatKobo(kobo: number | string | null | undefined): string {
  const value = Number(kobo ?? 0);
  return formatNaira(Number.isFinite(value) ? value : 0);
}

/** Whole-number accuracy, matching the student results page. Null when nothing was measured. */
export function accuracy(correct: number, total: number): number | null {
  return total > 0 ? Math.round((100 * correct) / total) : null;
}

export function formatPercent(value: number | null | undefined, empty = "—"): string {
  return value == null ? empty : `${value}%`;
}

/** "not_interested" → "Not interested". */
export function humanize(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  const text = value.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}
