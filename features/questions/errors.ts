/**
 * Provider-level failures. `studentMessage` is the only text safe to render in
 * the UI: upstream status codes, provider names and vendor wording stay in
 * `message`, which belongs in server logs only.
 */
export class QuestionProviderError extends Error {
  readonly studentMessage: string;

  constructor(message: string, studentMessage = "Questions are temporarily unavailable. Please try again shortly.") {
    super(message);
    this.name = "QuestionProviderError";
    this.studentMessage = studentMessage;
  }
}

/** Missing, rejected or deactivated credentials. Never retried. */
export class QuestionProviderAuthError extends QuestionProviderError {
  constructor(message: string) {
    super(message, "Questions are temporarily unavailable. Please try again shortly.");
    this.name = "QuestionProviderAuthError";
  }
}

/** Upstream quota exhausted. Retried only within the bounded policy. */
export class QuestionProviderRateLimitError extends QuestionProviderError {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message, "Questions are busy right now. Please try again in a moment.");
    this.name = "QuestionProviderRateLimitError";
  }
}

/** Timeout, network failure or 5xx that survived every retry. */
export class QuestionProviderUnavailableError extends QuestionProviderError {
  constructor(message: string) {
    super(message, "Questions are temporarily unavailable. Please try again shortly.");
    this.name = "QuestionProviderUnavailableError";
  }
}

/**
 * The active provider cannot honour a requested filter. Raised before a session
 * is created so a student is never shown unrelated questions under a filter
 * label the provider ignored.
 */
export class QuestionProviderUnsupportedFilterError extends QuestionProviderError {
  constructor(message: string, studentMessage: string) {
    super(message, studentMessage);
    this.name = "QuestionProviderUnsupportedFilterError";
  }
}

export function studentFacingMessage(error: unknown): string | null {
  return error instanceof QuestionProviderError ? error.studentMessage : null;
}
