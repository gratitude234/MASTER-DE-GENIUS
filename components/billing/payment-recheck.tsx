"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { ReconcileResult } from "@/features/billing/reconcile";

/**
 * The way out of a payment that settled upstream but never settled here.
 *
 * A student who paid, closed the tab before the callback ran, and whose webhook
 * never arrived is left on Free with a pending row nothing will ever close. The
 * fix is a student-initiated re-check, not a background sweep: it costs one
 * Paystack verification, it happens because somebody asked for it, and it goes
 * through exactly the endpoint the callback page already uses.
 *
 * Nothing here is authority. The reference is a lookup key, scoped server-side
 * to the authenticated student's own payments; the amount, the plan, the
 * duration and the decision all come from the server, which asks Paystack
 * directly and applies through the same locked function the webhook uses. A
 * reference belonging to somebody else answers "unknown", the same as one that
 * was invented.
 */
export function PaymentRecheck({ reference }: { reference: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setMessage(null);

    try {
      const response = await fetch("/api/billing/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The reference and nothing else. No user id, no amount, no plan.
        body: JSON.stringify({ reference }),
      });
      const payload = (await response.json().catch(() => null)) as (ReconcileResult & { error?: string }) | null;
      if (!response.ok || !payload?.state) {
        throw new Error(payload?.error || "We could not check this payment just now.");
      }

      if (payload.state === "success") {
        // The row changed server-side; the page is re-rendered rather than
        // patched, so the plan card and the history agree on one answer.
        setMessage("Payment confirmed. Your access is active.");
        router.refresh();
        return;
      }
      if (payload.state === "pending") {
        setMessage("Paystack has not confirmed this payment yet. Try again in a few minutes.");
        return;
      }
      setMessage("Paystack did not complete this payment, so nothing was activated.");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "We could not check this payment just now.");
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [reference, router]);

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="text-[11.5px] leading-[1.5] text-slate-600">
        Paid for this but still on Free? Check it against Paystack — if the money arrived, your access
        activates now.
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2"
        loading={checking}
        loadingLabel="Checking this payment"
        onClick={() => void check()}
      >
        Check this payment
      </Button>
      {message ? (
        <p role="status" className="mt-2 text-[11.5px] font-semibold text-slate-700">{message}</p>
      ) : null}
    </div>
  );
}
