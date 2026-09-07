"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function PracticeSessionError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not open this session"
      description="Answers you have already saved are safe. Try again, or return to practice and pick the session up from there."
      fallbackHref="/practice"
      fallbackLabel="Back to practice"
    />
  );
}
