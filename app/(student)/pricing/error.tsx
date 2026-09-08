"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function PricingError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not load the plans"
      description="No payment was started and nothing has been charged. Try again in a moment."
    />
  );
}
