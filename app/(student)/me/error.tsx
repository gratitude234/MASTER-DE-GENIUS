"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";

export default function ProfileError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="We could not load your profile"
      description="Your account and preparation settings are unchanged. This is only the page that failed to load."
    />
  );
}
