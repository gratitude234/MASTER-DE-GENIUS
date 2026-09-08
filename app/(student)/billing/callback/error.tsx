"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function BillingCallbackError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not check this payment"
      // Never imply a payment failed just because this page did.
      description="If money left your account, your access will still activate. Open Billing in a few minutes to confirm."
    />
  );
}
