import "server-only";

import {
  QuestionProviderAuthError,
  QuestionProviderError,
  QuestionProviderRateLimitError,
  QuestionProviderUnavailableError,
} from "@/features/questions/errors";

/** One central timeout for every upstream ALOC request. */
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 4_000;
const DEFAULT_BASE_URL = "https://questions.aloc.com.ng/api/v2";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface AlocConfig {
  baseUrl: string;
  token: string;
}

/**
 * Fails fast with an explicit configuration error rather than letting the first
 * request come back as a cryptic upstream rejection.
 */
export function requireAlocConfig(): AlocConfig {
  const token = process.env.ALOC_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new QuestionProviderAuthError(
      "QUESTION_PROVIDER=aloc requires ALOC_ACCESS_TOKEN. Set it in the server environment; it must never be prefixed with NEXT_PUBLIC_.",
    );
  }
  const baseUrl = (process.env.ALOC_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { baseUrl, token };
}

interface AlocEnvelope {
  status?: unknown;
  error?: unknown;
  subject?: unknown;
  data?: unknown;
}

/**
 * The legacy API does not use HTTP status codes consistently: a rejected token
 * returns HTTP 406 while the body reports 400 or 406, so classification reads
 * both and prefers the body when it carries a usable code.
 */
function effectiveStatus(httpStatus: number, body: AlocEnvelope | null): number {
  const declared = body?.status;
  return typeof declared === "number" && declared >= 100 && declared <= 599 ? declared : httpStatus;
}

function upstreamMessage(body: AlocEnvelope | null): string {
  return typeof body?.error === "string" ? body.error : "";
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header.trim(), 10);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 60);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(Math.max(0, Math.ceil((date - Date.now()) / 1000)), 60);
  return undefined;
}

function backoffDelay(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) return retryAfterSeconds * 1000;
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return exponential + Math.random() * BASE_BACKOFF_MS;      // jitter avoids retry storms
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface AlocRequestLog {
  path: string;
  subject: string;
  examType: string;
  attempt: number;
  status?: number;
  durationMs: number;
  outcome: "ok" | "retry" | "failed";
}

/** Never receives the token, the URL query string, or any answer data. */
function logCall(entry: AlocRequestLog) {
  console.info(
    `[questions] provider=aloc path=${entry.path} exam=${entry.examType} subject=${entry.subject} ` +
      `attempt=${entry.attempt}/${MAX_ATTEMPTS} status=${entry.status ?? "none"} ms=${entry.durationMs} ${entry.outcome}`,
  );
}

export interface AlocFetchOptions {
  path: string;
  query: Record<string, string | number | undefined>;
  subject: string;
  examType: string;
  config: AlocConfig;
  fetchImpl?: typeof fetch;
}

/**
 * Performs one logical upstream call with a bounded timeout and bounded retries,
 * returning the parsed envelope. Transient failures retry; client errors do not.
 */
export async function alocRequest(options: AlocFetchOptions): Promise<AlocEnvelope> {
  const { path, query, subject, examType, config } = options;
  const doFetch = options.fetchImpl ?? fetch;

  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  let lastError: QuestionProviderError = new QuestionProviderUnavailableError("ALOC request never ran.");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const response = await doFetch(url, {
        signal: controller.signal,
        headers: { AccessToken: config.token, Accept: "application/json" },
        cache: "no-store",
      });

      const text = await response.text();
      let body: AlocEnvelope | null = null;
      try {
        body = JSON.parse(text) as AlocEnvelope;
      } catch {
        body = null;
      }

      const status = effectiveStatus(response.status, body);
      const message = upstreamMessage(body);
      const durationMs = Date.now() - startedAt;

      if (response.ok && body && body.data !== undefined) {
        logCall({ path, subject, examType, attempt, status, durationMs, outcome: "ok" });
        return body;
      }

      // Credentials are wrong or revoked: retrying cannot help.
      if (status === 401 || status === 403 || ((status === 400 || status === 406) && /token/i.test(message))) {
        logCall({ path, subject, examType, attempt, status, durationMs, outcome: "failed" });
        throw new QuestionProviderAuthError(`ALOC rejected the access token (status ${status}): ${message || "no detail"}`);
      }

      if (status === 429) {
        const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
        lastError = new QuestionProviderRateLimitError(`ALOC rate limited the request (429).`, retryAfterSeconds);
        if (attempt < MAX_ATTEMPTS) {
          logCall({ path, subject, examType, attempt, status, durationMs, outcome: "retry" });
          await sleep(backoffDelay(attempt, retryAfterSeconds));
          continue;
        }
        logCall({ path, subject, examType, attempt, status, durationMs, outcome: "failed" });
        throw lastError;
      }

      if (RETRYABLE_STATUS.has(status)) {
        lastError = new QuestionProviderUnavailableError(`ALOC returned HTTP ${status}: ${message || "no detail"}`);
        if (attempt < MAX_ATTEMPTS) {
          logCall({ path, subject, examType, attempt, status, durationMs, outcome: "retry" });
          await sleep(backoffDelay(attempt));
          continue;
        }
        logCall({ path, subject, examType, attempt, status, durationMs, outcome: "failed" });
        throw lastError;
      }

      logCall({ path, subject, examType, attempt, status, durationMs, outcome: "failed" });
      throw new QuestionProviderError(`ALOC request failed with status ${status}: ${message || "no detail"}`);
    } catch (error) {
      clearTimeout(timer);

      if (error instanceof QuestionProviderError) throw error;

      // Timeout or network failure: transient by nature, so it is retryable.
      const aborted = error instanceof Error && error.name === "AbortError";
      lastError = new QuestionProviderUnavailableError(
        aborted
          ? `ALOC request timed out after ${REQUEST_TIMEOUT_MS}ms.`
          : `ALOC request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
      );
      logCall({
        path, subject, examType, attempt,
        durationMs: Date.now() - startedAt,
        outcome: attempt < MAX_ATTEMPTS ? "retry" : "failed",
      });
      if (attempt >= MAX_ATTEMPTS) throw lastError;
      await sleep(backoffDelay(attempt));
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

/** Legacy responses return either a single object or an array under `data`. */
export function envelopeRecords(body: AlocEnvelope): unknown[] {
  const data = body.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}
