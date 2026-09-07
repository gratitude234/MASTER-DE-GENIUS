import * as React from "react";
import { cn } from "@/lib/utils";
import { radius, typography } from "@/components/ui/variants";

export interface EmptyStateProps {
  /** Decorative illustration, usually a lucide icon. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Primary call to action — a <Button> or a styled <Link>. */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  /**
   * Heading level for the surrounding document outline. Defaults to h3, which
   * is right for a state nested under a section title.
   */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * The one "there is nothing here" panel: no attempts, no mistakes, no results,
 * content that is not available yet, and filters that matched nothing.
 *
 * Mobile-first — a single centred column that stays legible at 360px.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  return (
    <div
      className={cn(
        // A dashed hairline on the page ground, not a filled card: an absence
        // should not look like a result the student earned.
        "flex flex-col items-center border border-dashed border-slate-300 px-5 py-7 text-center sm:px-8",
        radius.card,
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "mb-4 grid h-12 w-12 place-items-center bg-slate-100 text-slate-500",
            radius.control,
          )}
        >
          {icon}
        </div>
      ) : null}

      <Heading className={typography.h2}>{title}</Heading>

      {description ? (
        <p className={cn(typography.body, "mt-2 max-w-sm text-slate-500")}>{description}</p>
      ) : null}

      {action || secondaryAction ? (
        <div className="mt-6 flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
