import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { radius, typography } from "@/components/ui/variants";

export interface ErrorStateProps {
  title?: string;
  /**
   * Plain-language explanation for a student. Never pass a thrown message, a
   * provider name or a status code — this component is presentation only.
   */
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  secondaryAction?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * The one "something went wrong" panel, for route error boundaries and for
 * views whose data failed to load.
 *
 * Announced politely rather than assertively: the student is looking at the
 * panel already, and an alert would interrupt anything else being read.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We could not load this just now. Check your connection and try again — nothing you have already done has been lost.",
  onRetry,
  retryLabel = "Try again",
  secondaryAction,
  headingLevel = 3,
  className,
}: ErrorStateProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center border border-slate-200 bg-white px-5 py-8 text-center sm:px-8",
        radius.card,
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "mb-4 grid h-12 w-12 place-items-center bg-danger-50 text-danger-600",
          radius.control,
        )}
      >
        <AlertTriangle className="h-5 w-5" />
      </div>

      <Heading className={typography.h2}>{title}</Heading>

      {description ? (
        <p className={cn(typography.body, "mt-2 max-w-sm text-slate-500")}>{description}</p>
      ) : null}

      {onRetry || secondaryAction ? (
        <div className="mt-6 flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
          {onRetry ? (
            <Button type="button" variant="dark" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
