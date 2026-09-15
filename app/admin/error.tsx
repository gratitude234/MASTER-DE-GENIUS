"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function AdminError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="This admin page could not load"
      description="No changes were made. Try again, or return to the overview."
      fallbackHref="/admin"
      fallbackLabel="Back to overview"
    />
  );
}
