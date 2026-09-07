"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/error-state";
import { buttonClasses } from "@/components/ui/variants";

export interface RouteErrorProps {
  /** Next's boundary payload. Reported, never rendered. */
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
  retryLabel?: string;
  /** Where to go when retrying is not enough. */
  fallbackHref?: string;
  fallbackLabel?: string;
}

/**
 * The shell every route `error.tsx` renders.
 *
 * The student sees plain language only — no message, digest, provider name or
 * stack ever reaches the page. The real error is still handed to the console so
 * it stays visible in logs and monitoring; nothing is swallowed, only untangled
 * from what a student is asked to read.
 */
export function RouteError({
  error,
  reset,
  title,
  description,
  retryLabel,
  fallbackHref = "/home",
  fallbackLabel = "Back to home",
}: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-6">
      <ErrorState
        headingLevel={2}
        title={title}
        description={description}
        onRetry={reset}
        retryLabel={retryLabel}
        secondaryAction={
          <Link href={fallbackHref} className={buttonClasses({ variant: "secondary", size: "lg" })}>
            {fallbackLabel}
          </Link>
        }
      />
    </div>
  );
}
