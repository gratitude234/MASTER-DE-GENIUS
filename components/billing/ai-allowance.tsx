"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { BillingTier } from "@/features/billing/plans";
import type { UsageMeter } from "@/features/billing/usage-types";

/**
 * Today's MASTER AI allowance, shared by every explanation panel on a page.
 *
 * A results page can hold forty "Explain better" buttons; after one of them
 * spends an explanation, the other thirty-nine must say the same thing. This
 * holds the count the server reported — seeded from the usage summary when the
 * page was rendered, then replaced by whatever each generation response says.
 * It never decides anything: the server charges and refuses every request.
 */

interface AiAllowanceState {
  tier: BillingTier;
  limit: number;
  remaining: number | null;
}

interface AiAllowanceContextValue {
  allowance: AiAllowanceState | null;
  /** The count the server just reported. */
  report: (remaining: number) => void;
}

const AiAllowanceContext = createContext<AiAllowanceContextValue>({ allowance: null, report: () => {} });

export function AiAllowanceProvider({
  initial,
  children,
}: {
  initial: { tier: BillingTier; meter: UsageMeter } | null;
  children: React.ReactNode;
}) {
  const [allowance, setAllowance] = useState<AiAllowanceState | null>(
    initial ? { tier: initial.tier, limit: initial.meter.limit, remaining: initial.meter.remaining } : null,
  );
  const report = useCallback((remaining: number) => {
    setAllowance((current) => (current ? { ...current, remaining: Math.max(0, remaining) } : current));
  }, []);
  const value = useMemo(() => ({ allowance, report }), [allowance, report]);
  return <AiAllowanceContext.Provider value={value}>{children}</AiAllowanceContext.Provider>;
}

export function useAiAllowance(): AiAllowanceContextValue {
  return useContext(AiAllowanceContext);
}
