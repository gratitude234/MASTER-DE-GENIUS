import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { selectClasses, type SelectSize } from "@/components/ui/variants";

export interface SelectProps
  // The native `size` attribute (visible row count) is replaced by the design
  // system's control height; a styled single select never needs the original.
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Control height: md = 44px, lg = 48px (matches AuthField). */
  size?: SelectSize;
  /** Validation hook — draws the error border and sets `aria-invalid`. */
  invalid?: boolean;
  /** Applied to the positioning wrapper rather than the control itself. */
  containerClassName?: string;
}

/**
 * A native <select> in the app's form chrome.
 *
 * Native keeps the whole keyboard and screen-reader contract for free — arrow
 * keys, type-ahead, the platform picker on mobile — which no custom listbox
 * would match without a dependency. The label belongs to the surrounding form
 * structure, so this renders the control only.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, size = "lg", invalid = false, disabled, ...props }, ref) => {
    return (
      <div className={cn("relative", containerClassName)}>
        <select
          ref={ref}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={selectClasses({ size, invalid, className })}
          {...props}
        />
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2",
            disabled ? "text-slate-300" : "text-slate-400",
          )}
        />
      </div>
    );
  },
);
Select.displayName = "Select";
