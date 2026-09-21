"use client";

import { useEffect } from "react";

import { track } from "@/features/analytics/events";
import type { UpgradeSource } from "@/features/billing/upgrade";

/** Records that the plan cards were reached, and from which prompt. Renders nothing. */
export function TrackPricingView({ source }: { source: UpgradeSource | null }) {
  useEffect(() => {
    track("upgrade_pricing_viewed", { source: source ?? "direct" });
  }, [source]);
  return null;
}
