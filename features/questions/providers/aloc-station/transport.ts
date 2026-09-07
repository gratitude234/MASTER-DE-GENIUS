import "server-only";

import {
  QuestionProviderAuthError,
  QuestionProviderError,
  QuestionProviderRateLimitError,
  QuestionProviderUnavailableError,
} from "@/features/questions/errors";
import type { QuestionRequestType } from "@/features/questions/types";
import { recordExternalApiUsage, type ExternalApiUsageEntry } from "@/lib/external-api-usage";

export const STATION_REQUEST_TIMEOUT_MS = 10_000;
export const STATION_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_URL = "https://dev.aloc.com.ng/api/v1";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface AlocStationConfig {
  baseUrl: string;
  apiKey: string;
}

export interface StationEnvelope {
  data?: unknown;
  pagination?: { nextCursor?: unknown; hasMore?: unknown };
  meta?: { creditsUsed?: unknown; creditsRemaining?: unknown; requestId?: unknown };
  error?: unknown;
  message?: unknown;
}

export type StationUsageRecorder = (entry: ExternalApiUsageEntry) => Promise<void>;

export function requireAlocStationConfig(): AlocStationConfig {
  const apiKey = process.env.ALOC_STATION_API_KEY?.trim();
  if (!apiKey) {
    throw new QuestionProviderAuthError(
      "QUESTION_PROVIDER=aloc_station requires ALOC_STATION_API_KEY in the server environment; never prefix it with NEXT_PUBLIC_.",
    );
  }
  const baseUrl = (process.env.ALOC_STATION_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { baseUrl, apiKey };
}

function headerInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function bodyInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeMessage(body: StationEnvelope | null): string {
  const value = body?.error ?? body?.message;
  return typeof value === "string" ? value.slice(0, 300) : "";
}

function recordCount(body: StationEnvelope | null): number {
  if (Array.isArray(body?.data)) return body.data.length;
  return body?.data && typeof body.data === "object" ? 1 : 0;
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 60)) : undefined;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface StationRequestOptions {
  path: string;
  query: Record<string, string | number | boolean | undefined>;
  examBody: string;
  subject: string;
  requestType: QuestionRequestType;
  requestedQuestionCount?: number;
  config: AlocStationConfig;
  fetchImpl?: typeof fetch;
  usageRecorder?: StationUsageRecorder;
}

export async function stationRequest(options: StationRequestOptions): Promise<StationEnvelope> {
  const doFetch = options.fetchImpl ?? fetch;
  const recordUsage = options.usageRecorder ?? recordExternalApiUsage;
  const url = new URL(`${options.config.baseUrl}${options.path}`);
  for (const [key, value] of Object.entries(options.query)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  let lastError: QuestionProviderError = new QuestionProviderUnavailableError("ALOC Station request never ran.");
  for (let attempt = 1; attempt <= STATION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATION_REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await doFetch(url, {
        signal: controller.signal,
        headers: { "X-API-Key": options.config.apiKey, Accept: "application/json" },
        cache: "no-store",
      });
      const raw = await response.text();
      let body: StationEnvelope | null = null;
      try { body = JSON.parse(raw) as StationEnvelope; } catch { body = null; }
      const durationMs = Date.now() - startedAt;
      const creditsUsed = headerInteger(response.headers, "X-Credits-Used") ?? bodyInteger(body?.meta?.creditsUsed);
      const creditsRemaining = headerInteger(response.headers, "X-Credits-Remaining") ?? bodyInteger(body?.meta?.creditsRemaining);
      const providerRequestId = response.headers.get("X-Request-Id")
        ?? (typeof body?.meta?.requestId === "string" ? body.meta.requestId : null);
      const baseUsage = {
        provider: "aloc_station",
        endpoint: options.path,
        requestType: options.requestType,
        examBody: options.examBody,
        subject: options.subject,
        requestedQuestionCount: options.requestedQuestionCount ?? null,
        questionCount: recordCount(body),
        httpStatus: response.status,
        durationMs,
        creditsUsed,
        creditsRemaining,
        providerRequestId,
      } satisfies Omit<ExternalApiUsageEntry, "outcome">;

      if (response.ok && body?.data !== undefined) {
        await recordUsage({ ...baseUsage, outcome: "ok" });
        return body;
      }

      const message = safeMessage(body);
      if (response.status === 401) {
        await recordUsage({ ...baseUsage, outcome: "failed" });
        throw new QuestionProviderAuthError(`ALOC Station rejected the API key (status ${response.status}): ${message || "no detail"}`);
      }
      if (response.status === 403 && /credit|quota|sandbox|limit/i.test(message)) {
        await recordUsage({ ...baseUsage, outcome: "failed" });
        throw new QuestionProviderRateLimitError(`ALOC Station credits are unavailable: ${message || "no detail"}`);
      }
      if (response.status === 429) {
        const retryAfter = retryAfterSeconds(response);
        lastError = new QuestionProviderRateLimitError("ALOC Station rate limited the request.", retryAfter);
        const outcome = attempt < STATION_MAX_ATTEMPTS ? "retry" : "failed";
        await recordUsage({ ...baseUsage, outcome });
        if (attempt < STATION_MAX_ATTEMPTS) {
          await sleep((retryAfter ?? attempt) * 1000);
          continue;
        }
        throw lastError;
      }
      if (RETRYABLE_STATUS.has(response.status)) {
        lastError = new QuestionProviderUnavailableError(`ALOC Station returned HTTP ${response.status}: ${message || "no detail"}`);
        const outcome = attempt < STATION_MAX_ATTEMPTS ? "retry" : "failed";
        await recordUsage({ ...baseUsage, outcome });
        if (attempt < STATION_MAX_ATTEMPTS) {
          await sleep(300 * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }

      await recordUsage({ ...baseUsage, outcome: "failed" });
      throw new QuestionProviderError(`ALOC Station request failed with status ${response.status}: ${message || "no detail"}`);
    } catch (error) {
      if (error instanceof QuestionProviderError) throw error;
      const durationMs = Date.now() - startedAt;
      await recordUsage({
        provider: "aloc_station", endpoint: options.path, requestType: options.requestType,
        examBody: options.examBody, subject: options.subject,
        requestedQuestionCount: options.requestedQuestionCount ?? null,
        questionCount: 0, httpStatus: null,
        outcome: attempt < STATION_MAX_ATTEMPTS ? "retry" : "failed", durationMs,
      });
      const aborted = error instanceof Error && error.name === "AbortError";
      lastError = new QuestionProviderUnavailableError(aborted
        ? `ALOC Station request timed out after ${STATION_REQUEST_TIMEOUT_MS}ms.`
        : `ALOC Station request failed: ${error instanceof Error ? error.message : "unknown network error"}`);
      if (attempt >= STATION_MAX_ATTEMPTS) throw lastError;
      await sleep(300 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export function stationRecords(body: StationEnvelope): unknown[] {
  return Array.isArray(body.data) ? body.data : body.data && typeof body.data === "object" ? [body.data] : [];
}
