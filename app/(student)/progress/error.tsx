"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function ProgressError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="Your results could not be loaded"
      description="Every attempt you have completed is still saved. Only this summary failed to load."
    />
  );
}
