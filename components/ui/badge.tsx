import * as React from "react";
import { cn } from "@/lib/utils";
import { badgeClasses, badgeDotClasses, type BadgeTone } from "@/components/ui/variants";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Small leading dot. Decorative — the label still carries the meaning. */
  dot?: boolean;
  icon?: React.ReactNode;
}

/**
 * The one status chip: "Not available yet", flagged, saved, syncing, offline,
 * days to exam, mistake streak.
 *
 * State is never carried by colour alone — every badge renders its own text,
 * and the dot is hidden from assistive technology.
 */
export function Badge({ className, tone = "neutral", dot = false, icon, children, ...props }: BadgeProps) {
  return (
    <span className={badgeClasses({ tone, className })} {...props}>
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", badgeDotClasses[tone])}
        />
      ) : null}
      {icon}
      {children}
    </span>
  );
}
