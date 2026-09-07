"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function PracticeError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not open practice setup"
      description="No session was started, so nothing has been used up. Try again in a moment."
    />
  );
}
