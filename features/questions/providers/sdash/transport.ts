import "server-only";

import {
  QuestionProviderAuthError,
  QuestionProviderError,
  QuestionProviderRateLimitError,
  QuestionProviderUnavailableError,
  QuestionProviderUnsupportedFilterError,
} from "@/features/questions/errors";
import type { QuestionRequestType } from "@/features/questions/types";
import { recordExternalApiUsage, type ExternalApiUsageEntry } from "@/lib/external-api-usage";

import type { SdashConfig } from "./config";

/** One central timeout for every upstream Sdash request. */
export const SDASH_REQUEST_TIMEOUT_MS = 10_000;
export const SDASH_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 4_000;

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

/**
 * The V1 envelope: `{ status, data }`, where `data` is one object when `limit`
 * is 1 or absent and an array when it is greater. Both shapes are handled by
 * `sdashRecords`; nothing above this module sees the difference.
 */
export interface SdashEnvelope {
  status?: unknown;
  data?: unknown;
  error?: unknown;
  message?: unknown;
}

export type SdashUsageRecorder = (entry: ExternalApiUsageEntry) => Promise<void>;

/**
 * Sdash sometimes answers with a body status that disagrees with the HTTP one.
 * Classification prefers the body when it carries a usable code, exactly as the
 * legacy ALOC adapter does for the same reason.
 */
function effectiveStatus(httpStatus: number, body: SdashEnvelope | null): number {
  const declared = body?.status;
  return typeof declared === "number" && declared >= 100 && declared <= 599 ? declared : httpStatus;
}

/**
 * Upstream wording, truncated and kept for server logs only. It is never put in
 * a student-facing message, and it never contains the access token: the token
 * travels in a header and is not echoed by the API.
 */
function safeMessage(body: SdashEnvelope | null): string {
  const value = body?.error ?? body?.message;
  return typeof value === "string" ? value.slice(0, 300) : "";
}

function recordCount(body: SdashEnvelope | null): number {
  if (Array.isArray(body?.data)) return body.data.length;
  return body?.data && typeof body.data === "object" ? 1 : 0;
}

function headerInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * A plan restriction rather than a suspended account. Sdash returns HTTP 403
 * for both, and the wording is the only thing that tells them apart — the
 * verification run got "This subject is not available for Sandbox testing.
 * Please upgrade to a paid plan to access English."
 */
const PLAN_RESTRICTION = /sandbox|upgrade|paid plan|not available for/i;

export interface SdashRequestOptions {
  path: string;
  query: Record<string, string | number | undefined>;
  /** MASTER exam code, for the usage ledger. Not the upstream identifier. */
  examBody: string;
  /** Upstream subject identifier, for the usage ledger. Never a secret. */
  subject: string;
  requestType: QuestionRequestType;
  requestedQuestionCount?: number;
  config: SdashConfig;
  fetchImpl?: typeof fetch;
  usageRecorder?: SdashUsageRecorder;
}

/**
 * One logical upstream call: bounded timeout, bounded retries, one usage ledger
 * row per attempt.
 *
 * `data: null` is returned for "no matching questions" rather than thrown. Sdash
 * answers an empty result with HTTP 404, and a filter combination that simply
 * has no inventory is not a provider failure — the assembler reports the
 * shortage honestly instead, and the requested filters are never relaxed to
 * paper over it.
 */
export async function sdashRequest(options: SdashRequestOptions): Promise<SdashEnvelope> {
  const doFetch = options.fetchImpl ?? fetch;
  const recordUsage = options.usageRecorder ?? recordExternalApiUsage;

  const url = new URL(`${options.config.baseUrl}${options.path}`);
  for (const [key, value] of Object.entries(options.query)) {
    // The token is never a query parameter: Sdash documents `?token=` as an
    // alternative and it would end up in proxy and access logs.
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  let lastError: QuestionProviderError = new QuestionProviderUnavailableError("Sdash request never ran.");

  for (let attempt = 1; attempt <= SDASH_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SDASH_REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const response = await doFetch(url, {
        signal: controller.signal,
        headers: { AccessToken: options.config.accessToken, Accept: "application/json" },
        cache: "no-store",
      });

      const raw = await response.text();
      let body: SdashEnvelope | null = null;
      try { body = JSON.parse(raw) as SdashEnvelope; } catch { body = null; }

      const status = effectiveStatus(response.status, body);
      const message = safeMessage(body);
      const durationMs = Date.now() - startedAt;
      const baseUsage = {
        provider: "sdash",
        endpoint: options.path,
        requestType: options.requestType,
        examBody: options.examBody,
        subject: options.subject,
        requestedQuestionCount: options.requestedQuestionCount ?? null,
        questionCount: recordCount(body),
        httpStatus: response.status,
        durationMs,
        // Sdash does not document credit headers; they are read opportunistically
        // and stay null when absent rather than being invented.
        creditsUsed: headerInteger(response.headers, "X-Credits-Used"),
        creditsRemaining: headerInteger(response.headers, "X-Credits-Remaining"),
        providerRequestId: response.headers.get("X-Request-Id"),
      } satisfies Omit<ExternalApiUsageEntry, "outcome">;

      if (response.ok && body?.data !== undefined && body.data !== null) {
        await recordUsage({ ...baseUsage, outcome: "ok" });
        return body;
      }

      // No question matched the filters. Not a failure, and not retryable.
      if (status === 404) {
        await recordUsage({ ...baseUsage, outcome: "ok" });
        return { status, data: [] };
      }

      if (status === 401) {
        await recordUsage({ ...baseUsage, outcome: "failed" });
        throw new QuestionProviderAuthError(
          `Sdash rejected the access token (status ${status}): ${message || "no detail"}`,
        );
      }

      if (status === 403) {
        await recordUsage({ ...baseUsage, outcome: "failed" });
        if (PLAN_RESTRICTION.test(message)) {
          throw new QuestionProviderUnsupportedFilterError(
            `Sdash refused this request on the current plan: ${message || "no detail"}`,
            "This subject is not available from the current question source yet.",
          );
        }
        throw new QuestionProviderAuthError(
          `Sdash refused the account (status ${status}): ${message || "no detail"}`,
        );
      }

      if (status === 429) {
        const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
        lastError = new QuestionProviderRateLimitError(
          `Sdash quota or rate limit reached: ${message || "no detail"}`,
          retryAfterSeconds,
        );
        await recordUsage({ ...baseUsage, outcome: attempt < SDASH_MAX_ATTEMPTS ? "retry" : "failed" });
        if (attempt < SDASH_MAX_ATTEMPTS) {
          await sleep(backoffDelay(attempt, retryAfterSeconds));
          continue;
        }
        throw lastError;
      }

      if (RETRYABLE_STATUS.has(status)) {
        lastError = new QuestionProviderUnavailableError(`Sdash returned HTTP ${status}: ${message || "no detail"}`);
        await recordUsage({ ...baseUsage, outcome: attempt < SDASH_MAX_ATTEMPTS ? "retry" : "failed" });
        if (attempt < SDASH_MAX_ATTEMPTS) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw lastError;
      }

      await recordUsage({ ...baseUsage, outcome: "failed" });
      throw new QuestionProviderError(
        response.ok && !body
          ? `Sdash returned a non-JSON body for subject "${options.subject}" (status ${status}).`
          : `Sdash request failed with status ${status}: ${message || "no detail"}`,
      );
    } catch (error) {
      if (error instanceof QuestionProviderError) throw error;

      const durationMs = Date.now() - startedAt;
      await recordUsage({
        provider: "sdash",
        endpoint: options.path,
        requestType: options.requestType,
        examBody: options.examBody,
        subject: options.subject,
        requestedQuestionCount: options.requestedQuestionCount ?? null,
        questionCount: 0,
        httpStatus: null,
        outcome: attempt < SDASH_MAX_ATTEMPTS ? "retry" : "failed",
        durationMs,
      });

      const aborted = error instanceof Error && error.name === "AbortError";
      lastError = new QuestionProviderUnavailableError(
        aborted
          ? `Sdash request timed out after ${SDASH_REQUEST_TIMEOUT_MS}ms.`
          : `Sdash request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
      );
      if (attempt >= SDASH_MAX_ATTEMPTS) throw lastError;
      await sleep(backoffDelay(attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

/** V1 returns one object for a single question and an array for a batch. */
export function sdashRecords(body: SdashEnvelope): unknown[] {
  const data = body.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}
