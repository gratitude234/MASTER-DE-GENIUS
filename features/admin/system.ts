import "server-only";

import { AI_PROMPT_VERSION, aiExplanationsEnabled, geminiApiKey, geminiModel } from "@/features/ai/config";
import { paystackConfigured, paystackEnvironment, paystackPublicKey } from "@/features/billing/paystack";
import { supportWhatsappNumber } from "@/features/classes/whatsapp";
import { isQuarantinedSubject, quarantinedSubjectEntries, subjectMappingEntries } from "@/features/questions/providers/aloc/mapping";
import { stationSubjectEntries } from "@/features/questions/providers/aloc-station/mapping";
import { getQuestionProvider } from "@/features/questions/providers";
import { verifiedRouteEntries } from "@/features/questions/routing";
import type { ProviderCapabilities, QuestionProviderId } from "@/features/questions/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Operational diagnostics. Every value here is either a boolean ("is it
 * configured?") or data that was never secret. No key, token, password or
 * provider URL credential is read into a return value.
 */

export interface ProviderStatus {
  id: QuestionProviderId;
  name: string;
  implemented: boolean;
  active: boolean;
  configured: boolean;
  configurationNote: string;
  capabilities: ProviderCapabilities | null;
  coverage: string[];
  usageTracked: boolean;
  usage: {
    requests24h: number;
    failures24h: number;
    retries24h: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    creditsRemaining: number | null;
  } | null;
}

function activeProviderId(): string {
  return process.env.QUESTION_PROVIDER?.trim() || "internal";
}

async function usageFor(provider: string): Promise<NonNullable<ProviderStatus["usage"]>> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const count = (outcome?: "failed" | "retry") => {
    let query = db.from("external_api_usage").select("id", { count: "exact", head: true }).eq("provider", provider).gte("created_at", since);
    if (outcome) query = query.eq("outcome", outcome);
    return query;
  };
  const latest = (outcome: "ok" | "failed") => db.from("external_api_usage")
    .select("created_at, credits_remaining").eq("provider", provider).eq("outcome", outcome)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const [requests, failures, retries, ok, failed] = await Promise.all([count(), count("failed"), count("retry"), latest("ok"), latest("failed")]);
  if (requests.error || failures.error || retries.error || ok.error || failed.error) throw new Error("Could not load provider usage.");
  return {
    requests24h: requests.count ?? 0,
    failures24h: failures.count ?? 0,
    retries24h: retries.count ?? 0,
    lastSuccessAt: ok.data?.created_at ?? null,
    lastFailureAt: failed.data?.created_at ?? null,
    creditsRemaining: ok.data?.credits_remaining ?? null,
  };
}

function capabilitiesOf(id: QuestionProviderId): ProviderCapabilities | null {
  try {
    return getQuestionProvider(id).capabilities;
  } catch {
    return null;
  }
}

export async function loadProviderStatuses(): Promise<ProviderStatus[]> {
  const active = activeProviderId();
  const stationJamb = stationSubjectEntries("jamb").length;
  const stationWaec = stationSubjectEntries("waec").length;
  const quarantined = quarantinedSubjectEntries().map(([, subject]) => subject.name);
  const alocMapped = subjectMappingEntries().filter(([slug]) => !isQuarantinedSubject(slug)).length;
  const sdashRoutes = verifiedRouteEntries()
    .filter((route) => route.provider === "sdash")
    .map((route) => `${route.examBody}/${route.subjectSlug}`);
  const [stationUsage, sdashUsage] = await Promise.all([usageFor("aloc_station"), usageFor("sdash")]);

  return [
    {
      id: "internal",
      name: "Internal question bank",
      implemented: true,
      active: active === "internal",
      configured: true,
      configurationNote: "Uses the Master De Genius database. No credentials.",
      capabilities: capabilitiesOf("internal"),
      coverage: ["Any exam and subject with active questions in the bank"],
      usageTracked: false,
      usage: null,
    },
    {
      id: "aloc_station",
      name: "ALOC Station",
      implemented: true,
      active: active === "aloc_station",
      configured: Boolean(process.env.ALOC_STATION_API_KEY?.trim()),
      configurationNote: "Requires ALOC_STATION_API_KEY on the server.",
      capabilities: capabilitiesOf("aloc_station"),
      coverage: [`JAMB: ${stationJamb} mapped subjects`, `WAEC: ${stationWaec} mapped subjects`],
      usageTracked: true,
      usage: stationUsage,
    },
    {
      id: "aloc",
      name: "ALOC (legacy)",
      implemented: true,
      active: active === "aloc",
      configured: Boolean(process.env.ALOC_ACCESS_TOKEN?.trim()),
      configurationNote: "Requires ALOC_ACCESS_TOKEN on the server. JAMB only.",
      capabilities: capabilitiesOf("aloc"),
      coverage: [
        `JAMB: ${alocMapped} mapped subjects`,
        ...(quarantined.length ? [`Quarantined pending verification: ${quarantined.join(", ")}`] : []),
      ],
      // The legacy transport does not write to external_api_usage, so its
      // traffic cannot be shown — saying "0 failures" would be invented.
      usageTracked: false,
      usage: null,
    },
    {
      id: "sdash",
      name: "Sdash",
      implemented: true,
      // "Active" means "this deployment's global provider", which Sdash is not
      // meant to be: it is reached through the verified exam+subject routing
      // table instead, and `coverage` below is where that shows.
      active: active === "sdash",
      configured: Boolean(process.env.SDASH_API_KEY?.trim()),
      configurationNote: process.env.SDASH_SANDBOX?.trim().toLowerCase() === "false"
        ? "Requires SDASH_API_KEY on the server. Production plan declared (SDASH_SANDBOX=false)."
        : "Requires SDASH_API_KEY on the server. Sandbox plan assumed: one examination year per subject, so year filtering is off.",
      capabilities: capabilitiesOf("sdash"),
      coverage: sdashRoutes.length
        ? [`Routed WAEC subjects: ${sdashRoutes.join(", ")}`]
        : ["No exam and subject currently route here"],
      usageTracked: true,
      usage: sdashUsage,
    },
  ];
}

export interface AiStatus {
  enabled: boolean;
  keyConfigured: boolean;
  model: string;
  promptVersion: string;
  last7d: { generated: number; cacheHits: number; failed: number };
  failureCategories: { category: string; count: number }[];
}

export async function loadAiStatus(): Promise<AiStatus> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const base = () => db.from("ai_usage").select("id", { count: "exact", head: true }).gte("created_at", since);
  const [generated, cacheHits, failed, failures] = await Promise.all([
    base().eq("status", "ok").eq("cache_hit", false),
    base().eq("status", "ok").eq("cache_hit", true),
    base().eq("status", "failed"),
    db.from("ai_usage").select("error_category").eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
  ]);
  if (generated.error || cacheHits.error || failed.error || failures.error) throw new Error("Could not load AI usage.");

  const tally = new Map<string, number>();
  for (const row of failures.data ?? []) tally.set(row.error_category ?? "unknown", (tally.get(row.error_category ?? "unknown") ?? 0) + 1);

  return {
    enabled: aiExplanationsEnabled(),
    keyConfigured: Boolean(geminiApiKey()),
    model: geminiModel(),
    promptVersion: AI_PROMPT_VERSION,
    last7d: { generated: generated.count ?? 0, cacheHits: cacheHits.count ?? 0, failed: failed.count ?? 0 },
    failureCategories: [...tally.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
  };
}

export interface BillingStatus {
  configured: boolean;
  environment: "test" | "live";
  publicKeyConfigured: boolean;
  recentWebhooks: { eventType: string; outcome: string; detail: string | null; receivedAt: string; processedAt: string | null }[];
}

export async function loadBillingStatus(): Promise<BillingStatus> {
  const { data, error } = await createAdminClient()
    .from("billing_webhook_events")
    .select("event_type, outcome, detail, received_at, processed_at")
    .order("received_at", { ascending: false })
    .limit(15);
  if (error) throw new Error("Could not load webhook history.");
  return {
    configured: paystackConfigured(),
    environment: paystackEnvironment(),
    publicKeyConfigured: Boolean(paystackPublicKey()),
    recentWebhooks: (data ?? []).map((row) => ({
      eventType: row.event_type, outcome: row.outcome, detail: row.detail, receivedAt: row.received_at, processedAt: row.processed_at,
    })),
  };
}

export function loadApplicationConfig() {
  return {
    activeQuestionProvider: activeProviderId(),
    appUrlConfigured: Boolean(process.env.NEXT_PUBLIC_APP_URL?.trim()),
    supportWhatsappConfigured: Boolean(supportWhatsappNumber()),
  };
}
