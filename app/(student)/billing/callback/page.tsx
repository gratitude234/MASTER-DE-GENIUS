import Link from "next/link";

import { PaymentStatus } from "@/components/billing/payment-status";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/variants";
import {
  parseCallbackReference,
  reconcilePayment,
  type ReconcileResult,
} from "@/features/billing/reconcile";
import { requireOnboardedUser } from "@/lib/auth";

export const metadata = {
  title: "Payment status",
};

export const dynamic = "force-dynamic";

/**
 * Where Paystack sends the student back to.
 *
 * The query string carries one thing this page will read: a reference. It is
 * never trusted to say whether the payment succeeded, what it cost, which plan
 * it was, or whose account it belongs to — all of that is looked up server-side
 * against the payment this server itself created for this authenticated user.
 *
 * The first reconciliation runs here, on the server, so a payment the webhook
 * has already settled renders as confirmed on the very first paint.
 */
export default async function BillingCallbackPage({
  searchParams,
}: {
  // A repeated query key arrives as an array, so the value type is the one
  // Next.js actually provides rather than the narrower one this page wants.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireOnboardedUser();
  // Paystack names the reference twice, as `reference` and `trxref`, and either
  // may arrive more than once. Whatever shape it takes, it is only ever a
  // lookup key — see `parseCallbackReference` for how the two are reconciled.
  const reference = parseCallbackReference(await searchParams);

  let initial: ReconcileResult | null = null;
  if (reference) {
    try {
      initial = await reconcilePayment(user.id, reference);
    } catch {
      initial = null;
    }
  }

  if (!initial) {
    return (
      <div className="screen-enter mx-auto max-w-[640px]">
        <EmptyState
          title="No payment to show"
          description="This link does not carry a payment we can look up. Your billing page lists every payment on your account."
          headingLevel={2}
          action={
            <Link href="/billing" className={buttonClasses({ variant: "primary", size: "lg" })}>
              View billing
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen-enter mx-auto max-w-[640px]">
      <PaymentStatus initial={initial} />
    </div>
  );
}
