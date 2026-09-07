"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "@/components/ui/variants";

export type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  /** Always-visible guidance, announced with the field. */
  hint?: string;
  /** Confirmation shown once a field is valid, e.g. "Passwords match". */
  success?: string;
  /** Adds a show/hide control. Only meaningful for `type="password"`. */
  revealable?: boolean;
};

/**
 * The app's labelled text input.
 *
 * The label is explicitly associated rather than wrapping the control, because
 * a reveal button cannot live inside a <label> without the label's click target
 * swallowing it. Hints, errors and confirmations are wired to the input through
 * `aria-describedby`, so a screen reader reads the problem with the field
 * instead of stranding it somewhere else in the form.
 */
export function AuthField({
  label,
  error,
  hint,
  success,
  revealable = false,
  className,
  type = "text",
  ...props
}: AuthFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const successId = `${fieldId}-success`;

  const describedBy = [hint ? hintId : null, error ? errorId : null, !error && success ? successId : null]
    .filter(Boolean)
    .join(" ");

  const resolvedType = revealable && revealed ? "text" : type;

  return (
    <div>
      <label htmlFor={fieldId} className="block text-xs font-bold text-slate-700">
        {label}
      </label>

      <div className="relative mt-1.5">
        <input
          {...props}
          id={fieldId}
          type={resolvedType}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={fieldClasses({ invalid: Boolean(error), className: cn(revealable && "pr-12", className) })}
        />
        {revealable ? (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            aria-controls={fieldId}
            className="absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-xl text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none"
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      {hint ? (
        <span id={hintId} className="mt-1.5 block text-[11px] font-medium text-slate-500">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="mt-1.5 block text-xs font-semibold text-danger-600">
          {error}
        </span>
      ) : null}
      {!error && success ? (
        <span id={successId} className="mt-1.5 block text-xs font-semibold text-success-700">
          {success}
        </span>
      ) : null}
    </div>
  );
}
