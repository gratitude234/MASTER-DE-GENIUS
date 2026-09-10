/**
 * A vendor-neutral event seam.
 *
 * The repository has no analytics infrastructure, and Premium Classes is not a
 * good reason to introduce a vendor. So this records the named events the
 * support and tutoring surfaces emit, and routes them to a sink that is not
 * installed yet. Wiring a real destination later is a single `setAnalyticsSink`
 * call in a client provider; no call site has to change.
 *
 * Properties must stay non-identifying: sources, slugs, statuses and counts.
 * Never pass names, phone numbers, emails, answers, or score history.
 */

export const ANALYTICS_EVENTS = [
  "support_cta_viewed",
  "support_cta_opened",
  "support_option_selected",
  "support_whatsapp_clicked",
  "class_recommendation_viewed",
  "class_cta_clicked",
  "class_request_started",
  "class_request_submitted",
  "class_whatsapp_clicked",
  "class_lead_status_changed",
  "class_lead_enrolled",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
export type AnalyticsProperties = Record<string, string | number | boolean | null>;
export type AnalyticsSink = (event: AnalyticsEvent, properties: AnalyticsProperties) => void;

let sink: AnalyticsSink | null = null;

/** Installs the destination. Passing null disables tracking again. */
export function setAnalyticsSink(next: AnalyticsSink | null) {
  sink = next;
}

/** Never throws: a broken or missing sink must not break a support control. */
export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}) {
  try {
    sink?.(event, properties);
  } catch {
    // Analytics is best-effort by design.
  }
}
