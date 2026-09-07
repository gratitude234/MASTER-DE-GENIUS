"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function ResultError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not load this result"
      description="Your score is saved and will not change. Try again, or open it from your results list."
      fallbackHref="/progress"
      fallbackLabel="Back to progress"
    />
  );
}
