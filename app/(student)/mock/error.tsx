"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function MockError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not set up your mock"
      description="No exam was started, so nothing has been used up. Try again in a moment."
    />
  );
}
