"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { BillingPlan } from "@/features/billing/plans";

interface CheckoutButtonProps {
  plan: BillingPlan;
  label: string;
  variant?: "primary" | "dark" | "secondary";
  /** Set while any card on the page is initializing, so only one can run. */
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}

/**
 * Starts one Paystack checkout.
 *
 * Two separate guards stop a double payment, because they fail in different
 * ways. This component refuses a second click while one is in flight, which
 * covers the common case instantly; and the server collapses rapid
 * initializations onto one pending transaction, which covers the cases the
 * browser cannot — a reload mid-request, a second tab, a hostile client.
 *
 * The button is a real `<button>` and the redirect happens after the server
 * answers, so keyboard users get the same behaviour and focus handling as
 * everyone else.
 */
export function CheckoutButton({ plan, label, variant = "primary", busy, onBusyChange }: CheckoutButtonProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy || starting) return;
    setStarting(true);
    onBusyChange(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The slug is the only thing sent. The price on this card is for the
        // student to read; the server decides what it actually costs.
        body: JSON.stringify({ planSlug: plan.slug }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { authorizationUrl?: string; error?: string }
        | null;

      if (!response.ok || !payload?.authorizationUrl) {
        throw new Error(payload?.error || "We could not start this payment. Please try again.");
      }

      // A full navigation, not a router push: Paystack's checkout is not part
      // of this application.
      window.location.assign(payload.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not start this payment. Please try again.");
      setStarting(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="mt-5 space-y-2.5">
      <Button
        type="button"
        variant={variant}
        size="lg"
        fullWidth
        loading={starting}
        loadingLabel={`Opening secure checkout for ${plan.name}`}
        disabled={busy && !starting}
        iconBefore={<CreditCard className="h-4 w-4" aria-hidden="true" />}
        onClick={() => void start()}
      >
        {label}
      </Button>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    </div>
  );
}
