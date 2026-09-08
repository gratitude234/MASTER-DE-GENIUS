"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buttonClasses, radius, typography } from "@/components/ui/variants";
import type { ReconcileResult, ReconcileState } from "@/features/billing/reconcile";
import { formatNaira } from "@/features/billing/plans";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** How long to keep polling before handing the student a manual retry. */
const MAX_POLLS = 8;
const POLL_INTERVAL_MS = 2500;

interface PaymentStatusProps {
  initial: ReconcileResult;
}

const presentation: Record<ReconcileState, {
  icon: typeof CheckCircle2;
  title: string;
  tone: string;
  iconTone: string;
}> = {
  success: { icon: CheckCircle2, title: "Payment confirmed", tone: "border-success-200 bg-success-50", iconTone: "text-success-600" },
  pending: { icon: Clock3, title: "Confirming your payment", tone: "border-warning-200 bg-warning-50", iconTone: "text-warning-600" },
  failed: { icon: XCircle, title: "Payment did not go through", tone: "border-danger-200 bg-danger-50", iconTone: "text-danger-600" },
  abandoned: { icon: AlertCircle, title: "Payment was cancelled", tone: "border-slate-200 bg-slate-50", iconTone: "text-slate-500" },
  unknown: { icon: AlertCircle, title: "We could not find that payment", tone: "border-slate-200 bg-slate-50", iconTone: "text-slate-500" },
};

/**
 * The page a student lands on after Paystack.
 *
 * The redirect that brought them here proves nothing — it is a GET their own
 * browser performed, and its query string is entirely under their control. So
 * this component never reads a status, an amount or a plan from the URL. It
 * sends the reference to the server, which looks up the payment *it* created
 * for *this* user and answers from its own records.
 *
 * "Success" is shown only once the server confirms the entitlement is actually
 * active locally. While the webhook is still settling, the honest answer is
 * "confirming", and that is what appears.
 */
export function PaymentStatus({ initial }: PaymentStatusProps) {
  const [result, setResult] = useState<ReconcileResult>(initial);
  const [checking, setChecking] = useState(false);
  const [pollsUsed, setPollsUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Survives re-renders so an in-flight check is never started twice.
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The reference and nothing else. No user id, no price, no duration.
        body: JSON.stringify({ reference: initial.reference }),
      });
      const payload = (await response.json().catch(() => null)) as (ReconcileResult & { error?: string }) | null;
      if (!response.ok || !payload?.state) {
        throw new Error(payload?.error || "We could not check this payment just now.");
      }
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not check this payment just now.");
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [initial.reference]);

  // Only a genuinely unresolved payment is polled, and only for a bounded
  // number of attempts — an indefinite poll would hammer the endpoint from a
  // tab the student left open.
  useEffect(() => {
    if (result.state !== "pending" || pollsUsed >= MAX_POLLS) return;
    const timer = setTimeout(() => {
      setPollsUsed((count) => count + 1);
      void check();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [result.state, pollsUsed, check]);

  const view = presentation[result.state];
  const Icon = view.icon;
  const exhausted = result.state === "pending" && pollsUsed >= MAX_POLLS;

  return (
    <div className="space-y-4">
      <section
        aria-live="polite"
        className={cn("border p-5 lg:p-6", radius.hero, view.tone)}
      >
        <div className="flex items-start gap-3.5">
          <Icon aria-hidden="true" className={cn("mt-0.5 h-6 w-6 shrink-0", view.iconTone)} />
          <div className="min-w-0">
            <h1 className="font-serif text-xl font-semibold tracking-[-0.01em] text-slate-950 sm:text-2xl">
              {view.title}
            </h1>

            {result.state === "success" ? (
              <p className="mt-2 text-[13px] leading-[1.6] text-slate-700">
                Your <strong className="font-bold text-slate-950">{result.planName}</strong> access is active
                {result.expiresAt ? (
                  <> until <strong className="font-bold text-slate-950">{dateFormatter.format(new Date(result.expiresAt))}</strong></>
                ) : null}
                . Everything you had before is still here — you simply have more room now.
              </p>
            ) : null}

            {result.state === "pending" ? (
              <p className="mt-2 text-[13px] leading-[1.6] text-slate-700">
                {exhausted
                  ? "This is taking longer than usual. Your payment is safe — if money left your account, your access will activate as soon as the confirmation arrives. Check again below, or open Billing in a few minutes."
                  : "We are confirming this with Paystack. This usually takes a few seconds — you can stay on this page."}
              </p>
            ) : null}

            {result.state === "failed" ? (
              <p className="mt-2 text-[13px] leading-[1.6] text-slate-700">
                No access was activated and, if your bank showed a hold, it is released rather than taken.
                You can try again with the same or a different plan.
              </p>
            ) : null}

            {result.state === "abandoned" ? (
              <p className="mt-2 text-[13px] leading-[1.6] text-slate-700">
                You left the Paystack page before completing this payment. Nothing was charged, and you can
                start again whenever you are ready.
              </p>
            ) : null}

            {result.state === "unknown" ? (
              <p className="mt-2 text-[13px] leading-[1.6] text-slate-700">
                We have no record of this payment on your account. If you believe you were charged, open
                Billing — every payment you have made appears there with its reference.
              </p>
            ) : null}

            {result.amountKobo != null && result.state !== "unknown" ? (
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5">
                <div className="flex items-baseline gap-1.5">
                  <dt className={typography.caption}>Amount</dt>
                  <dd className="mono-number text-[12.5px] font-semibold text-slate-900">
                    {formatNaira(result.amountKobo)}
                  </dd>
                </div>
                {result.accessDays ? (
                  <div className="flex items-baseline gap-1.5">
                    <dt className={typography.caption}>Access</dt>
                    <dd className="text-[12.5px] font-semibold text-slate-900">{result.accessDays} days</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          {result.state === "success" ? (
            <>
              <Link href="/home" className={buttonClasses({ variant: "dark", size: "lg", className: "w-full sm:w-auto sm:min-w-44" })}>
                Start studying
              </Link>
              <Link href="/billing" className={buttonClasses({ variant: "secondary", size: "lg", className: "w-full sm:w-auto" })}>
                View billing
              </Link>
            </>
          ) : null}

          {result.state === "pending" ? (
            <Button
              type="button"
              variant="dark"
              size="lg"
              className="w-full sm:w-auto sm:min-w-44"
              loading={checking}
              loadingLabel="Checking your payment"
              onClick={() => void check()}
            >
              Check again
            </Button>
          ) : null}

          {result.state === "failed" || result.state === "abandoned" || result.state === "unknown" ? (
            <>
              <Link href="/pricing" className={buttonClasses({ variant: "primary", size: "lg", className: "w-full sm:w-auto sm:min-w-44" })}>
                Back to plans
              </Link>
              <Link href="/billing" className={buttonClasses({ variant: "secondary", size: "lg", className: "w-full sm:w-auto" })}>
                View billing
              </Link>
            </>
          ) : null}
        </div>

        {error ? (
          <p role="status" className="mt-3 text-[12px] font-semibold text-danger-700">{error}</p>
        ) : null}
      </section>
    </div>
  );
}
