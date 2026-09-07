"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function HomeError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not load your dashboard"
      description="Your attempts, results and saved mistakes are all safe. This is only the summary that failed to load."
      fallbackHref="/practice"
      fallbackLabel="Go to practice"
    />
  );
}
