import Link from "next/link";

import { PaymentStatus } from "@/components/billing/payment-status";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/variants";
import { reconcilePayment, type ReconcileResult } from "@/features/billing/reconcile";
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
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const { user } = await requireOnboardedUser();
  const params = await searchParams;
  // Paystack sends `reference`; some flows also echo `trxref`. Either is only
  // ever a lookup key.
  const reference = params.reference ?? params.trxref ?? "";

  let initial: ReconcileResult | null = null;
  try {
    initial = await reconcilePayment(user.id, reference);
  } catch {
    initial = null;
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
