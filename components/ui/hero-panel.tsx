import * as React from "react";
import { cn } from "@/lib/utils";
import { radius, typography } from "@/components/ui/variants";

export interface HeroPanelProps extends React.HTMLAttributes<HTMLElement> {
  /** Small uppercase label above the heading. */
  eyebrow?: string;
  /** Sits to the right on wide screens — a link, a button, a badge. */
  action?: React.ReactNode;
}

/**
 * The dark slate-950 hero shell.
 *
 * One shape for the moments that lead a page: the result score banner and the
 * mistake-bank entry both used to hand-roll their own. It supplies chrome only
 * — the number, the copy and the call to action stay with the caller.
 */
export function HeroPanel({ className, eyebrow, action, children, ...props }: HeroPanelProps) {
  return (
    <section
      className={cn("overflow-hidden bg-slate-950 p-6 text-white shadow-soft sm:p-8", radius.hero, className)}
      {...props}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
        <div className="min-w-0">
          {eyebrow ? <p className={cn(typography.eyebrow, "text-white/60")}>{eyebrow}</p> : null}
          {children}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </section>
  );
}
