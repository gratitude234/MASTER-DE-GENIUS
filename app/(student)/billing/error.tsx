"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function BillingError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not load your billing"
      // Reassurance first: a billing page that fails to load must not read as
      // access or payments having been lost.
      description="Your plan and your payment history are safe. Try again in a moment."
    />
  );
}
