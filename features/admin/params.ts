/**
 * Query-string parsing for admin list pages. Filters live in the URL so a view
 * can be refreshed, bookmarked and shared between admins; every value is
 * validated here before it reaches a database call.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function textParam(params: SearchParams, key: string, maxLength = 120): string | undefined {
  const raw = params[key];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value.slice(0, maxLength) : undefined;
}

export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function pageParam(params: SearchParams): number {
  const page = Number.parseInt(textParam(params, "page") ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

/** A calendar date as `YYYY-MM-DD`, or undefined. */
export function dateParam(params: SearchParams, key: string): string | undefined {
  const value = textParam(params, key, 10);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? undefined : value;
}

/** Start of a WAT calendar day, as an ISO instant. */
export function startOfDayWat(date: string): string {
  return new Date(`${date}T00:00:00+01:00`).toISOString();
}

/** End (exclusive) of a WAT calendar day, as an ISO instant. */
export function endOfDayWat(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00+01:00`) + 86_400_000).toISOString();
}

export function daysAgoIso(days: number, now: number = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString();
}

/** Builds a link to the same list with some filters changed and empty ones dropped. */
export function hrefWith(pathname: string, current: Record<string, string | undefined>, changes: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

export function pageWindow(page: number, pageSize: number) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}
