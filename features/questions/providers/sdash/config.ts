import "server-only";

import { QuestionProviderAuthError } from "@/features/questions/errors";

/**
 * SdashAPI V1. The documented origin and version path; `SDASH_BASE_URL` exists
 * so a deployment can be pinned to a different version or a proxy without a
 * code change, matching how both ALOC adapters are configured.
 */
const DEFAULT_BASE_URL = "https://sdashapi.com/api/v1";

export interface SdashConfig {
  baseUrl: string;
  /** Sent as the `AccessToken` header. Never logged, never serialised. */
  accessToken: string;
  /**
   * Whether this deployment holds a Sandbox credential.
   *
   * Sandbox is not a smaller production: it answers each subject from a single
   * examination year and refuses subjects outside the free tier. Advertising
   * year selection against it would let a student pick 2019 WAEC Physics and
   * receive nothing, so the flag turns the year capability off rather than
   * letting the product make a promise the plan cannot keep.
   *
   * Defaults to sandbox. A deployment that has bought production access opts
   * out explicitly; forgetting to costs a filter, not a broken session.
   */
  sandbox: boolean;
}

/** True when a token is present. Used for availability gating; never logged. */
export function sdashConfigured(): boolean {
  return Boolean(process.env.SDASH_API_KEY?.trim());
}

/** True unless the deployment has explicitly declared production Sdash access. */
export function sdashSandbox(): boolean {
  return process.env.SDASH_SANDBOX?.trim().toLowerCase() !== "false";
}

/**
 * Fails fast with a configuration error rather than letting the first request
 * come back as an opaque upstream rejection. The message names the variable and
 * never contains its value.
 */
export function requireSdashConfig(): SdashConfig {
  const accessToken = process.env.SDASH_API_KEY?.trim();
  if (!accessToken) {
    throw new QuestionProviderAuthError(
      "The sdash question provider requires SDASH_API_KEY in the server environment; never prefix it with NEXT_PUBLIC_.",
    );
  }
  const baseUrl = (process.env.SDASH_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { baseUrl, accessToken, sandbox: sdashSandbox() };
}
