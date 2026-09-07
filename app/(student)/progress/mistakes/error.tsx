"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function MistakesError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not load your mistake bank"
      description="Nothing has been lost — your saved mistakes are rebuilt from completed attempts each time you open this page."
      fallbackHref="/progress"
      fallbackLabel="Back to progress"
    />
  );
}
