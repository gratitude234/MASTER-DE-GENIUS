import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buttonClasses,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/variants";

interface ButtonBaseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a centred spinner without changing the button's width. */
  loading?: boolean;
  /** Announced while `loading`, for users who cannot see the spinner. */
  loadingLabel?: string;
  iconBefore?: React.ReactNode;
  iconAfter?: React.ReactNode;
  fullWidth?: boolean;
}

/**
 * An icon-only button carries no text, so an accessible name has to come from
 * `aria-label`. The type makes that non-optional rather than a review comment.
 */
export type ButtonProps = ButtonBaseProps &
  ({ iconOnly: true; "aria-label": string } | { iconOnly?: false });

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      iconOnly = false,
      fullWidth = false,
      loading = false,
      loadingLabel = "Working…",
      iconBefore,
      iconAfter,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      // `type` is deliberately left to the caller: inside a <form> the native
      // default is submit, and overriding it here would silently break the
      // auth and profile forms when they migrate onto this component.
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={buttonClasses({ variant, size, iconOnly, fullWidth, className })}
        {...props}
      >
        {loading ? (
          <>
            <span className="absolute inset-0 grid place-items-center">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            </span>
            <span className="sr-only">{loadingLabel}</span>
          </>
        ) : null}
        {/*
          The label keeps its box while loading (`invisible`, not unmounted), so
          swapping into the loading state never resizes the button or shifts the
          layout around it.
        */}
        <span
          className={cn(
            "inline-flex items-center justify-center gap-2",
            loading ? "invisible" : null,
          )}
        >
          {iconBefore}
          {children}
          {iconAfter}
        </span>
      </button>
    );
  },
);
Button.displayName = "Button";
