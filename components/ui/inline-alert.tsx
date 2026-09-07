import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { inlineAlertClasses, type AlertTone } from "@/components/ui/variants";

const toneIcon: Record<AlertTone, React.ComponentType<{ className?: string }>> = {
  danger: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  brand: Info,
};

/**
 * A failure needs to interrupt; a confirmation should wait its turn. Assistive
 * technology gets that distinction from the role rather than from the colour.
 */
const toneRole: Record<AlertTone, "alert" | "status"> = {
  danger: "alert",
  success: "status",
  warning: "status",
  brand: "status",
};

export interface InlineAlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  /** Overrides the tone's default live-region role. */
  role?: "alert" | "status";
}

/**
 * The one in-form message band, for validation failures and confirmations
 * beside the control that produced them.
 *
 * Every tone renders its own icon, so the meaning survives without colour — and
 * a live-region role, so it survives without sight.
 */
export function InlineAlert({ className, tone = "danger", role, children, ...props }: InlineAlertProps) {
  const Icon = toneIcon[tone];

  return (
    <div role={role ?? toneRole[tone]} className={inlineAlertClasses({ tone, className })} {...props}>
      <Icon className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
