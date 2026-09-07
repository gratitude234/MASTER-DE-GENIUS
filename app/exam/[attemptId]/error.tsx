"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function ExamError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      // Retrying only re-loads the page; it starts, submits and changes nothing.
      title="We could not open your exam"
      description="Your attempt and every answer already saved are untouched. Try again — if it keeps failing, open the exam again from your dashboard."
      retryLabel="Try again"
      fallbackHref="/home"
      fallbackLabel="Back to home"
    />
  );
}
