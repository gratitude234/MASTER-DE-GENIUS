import { cn } from "@/lib/utils";

/**
 * The design-system recipes shared by the UI primitives.
 *
 * Class strings live here rather than inside the components so the conventions
 * are stated once, can be reused by any future primitive, and stay directly
 * testable without a DOM. Components own the markup; this module owns the look.
 */

/**
 * Radius is a three-tier rule, not a free choice:
 *   control — buttons, inputs, chips, small action tiles
 *   card    — standard cards and panels (the default)
 *   hero    — auth/onboarding shells, result heroes, sheet top corners
 */
export const radius = {
  control: "rounded-xl",
  card: "rounded-2xl",
  hero: "rounded-3xl",
} as const;

/** 2px brand ring, offset 2 — the one focus treatment for keyboard users. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

/** Ring drawn on focus rather than focus-visible, for text-entry style controls. */
export const fieldFocusRing =
  "outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10";

/** One disabled treatment everywhere: half opacity, no pointer interaction. */
export const disabledState = "disabled:pointer-events-none disabled:opacity-50";

/**
 * The approved type scale. These are conventions for new and migrated surfaces,
 * not a global reset — existing screens adopt them screen by screen.
 */
export const typography = {
  /** Score heroes only. */
  display: "text-[40px] font-black leading-[1.05] tracking-[-0.04em] sm:text-5xl",
  /** Page titles. Extrabold, not black — h1 is a frequent element. */
  h1: "text-2xl font-extrabold tracking-[-0.02em] text-slate-950 sm:text-[28px]",
  /** Section titles. */
  h2: "text-[15px] font-bold text-slate-950 sm:text-base",
  /** Small uppercase label above a title. */
  eyebrow: "text-[10px] font-bold uppercase tracking-[0.14em] sm:text-[11px]",
  /** Running copy. */
  body: "text-sm leading-6 text-slate-600 sm:text-[15px]",
  /** Supporting copy. Never slate-300 — that shade is reserved for placeholders. */
  caption: "text-[11px] font-medium leading-5 text-slate-500 sm:text-xs",
} as const;

/**
 * Tab-bar clearance for sticky mobile actions. Backed by the `--nav-clearance`
 * custom property in app/globals.css, so the 68px bar height and the safe-area
 * inset are stated exactly once.
 */
export const navClearance = {
  /** Sticky/fixed element sitting directly above the tab bar. */
  bottom: "bottom-nav-clearance",
  /** Scroll container that must not end underneath the tab bar. */
  padding: "pb-nav-clearance",
  /** The tab bar itself. */
  height: "h-nav-height",
} as const;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dark";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500",
  secondary:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400",
  danger: "bg-danger-600 text-white hover:bg-danger-700 focus-visible:ring-danger-600",
  // The high-commit action already used for sign-in, finish-session and
  // resume-exam: slate-950 on white.
  dark: "bg-slate-950 text-white hover:bg-slate-800 focus-visible:ring-slate-900",
};

/**
 * md/lg/xl all clear the 44px touch minimum. `sm` is 36px on purpose: it is the
 * dense in-toolbar control, and is only appropriate beside other small controls.
 */
export const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-xs",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-sm",
  xl: "h-[52px] px-6 text-sm font-extrabold",
};

/** Square footprint for icon-only buttons, matched to each size's height. */
export const buttonIconOnlySizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 w-9 px-0",
  md: "h-11 w-11 px-0",
  lg: "h-12 w-12 px-0",
  xl: "h-[52px] w-[52px] px-0",
};

const buttonBase = cn(
  "relative inline-flex select-none items-center justify-center whitespace-nowrap font-bold",
  radius.control,
  "transition duration-150 motion-reduce:transition-none",
  // Pressed feedback is owned by the primitive so it can never leak onto
  // arbitrary buttons and cards elsewhere in the app.
  "motion-safe:active:scale-[0.98]",
  focusRing,
  disabledState,
);

export function buttonClasses({
  variant = "primary",
  size = "md",
  iconOnly = false,
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(
    buttonBase,
    buttonVariantClasses[variant],
    iconOnly ? buttonIconOnlySizeClasses[size] : buttonSizeClasses[size],
    fullWidth ? "w-full" : null,
    className,
  );
}

export type FieldSize = "md" | "lg";

export const fieldSizeClasses: Record<FieldSize, string> = {
  md: "h-11 text-sm",
  lg: "h-12 text-[15px]",
};

/**
 * The one text-input chrome, taken from the auth fields: 48px, control radius,
 * brand focus ring, slate-300 placeholders. Shared by AuthField and the profile
 * form so a text input looks the same wherever it appears.
 */
export function fieldClasses({
  size = "lg",
  invalid = false,
  className,
}: { size?: FieldSize; invalid?: boolean; className?: string } = {}): string {
  return cn(
    "w-full border border-slate-200 bg-white px-3.5 text-slate-950 placeholder:text-slate-300",
    radius.control,
    fieldSizeClasses[size],
    "transition duration-150 motion-reduce:transition-none",
    fieldFocusRing,
    "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-50",
    invalid ? "border-danger-400 focus:border-danger-500 focus:ring-danger-500/10" : null,
    className,
  );
}

export type AlertTone = "danger" | "success" | "warning" | "brand";

export const alertToneClasses: Record<AlertTone, string> = {
  danger: "border-danger-200 bg-danger-50 text-danger-700",
  success: "border-success-200 bg-success-50 text-success-700",
  warning: "border-warning-200 bg-warning-50 text-warning-800",
  brand: "border-brand-500/15 bg-brand-50 text-brand-600",
};

export function inlineAlertClasses({
  tone = "danger",
  className,
}: { tone?: AlertTone; className?: string } = {}): string {
  return cn(
    "flex items-start gap-2.5 border px-3.5 py-3 text-sm font-semibold leading-5",
    radius.control,
    alertToneClasses[tone],
    className,
  );
}

export type SelectSize = FieldSize;

/** Selects share the field heights so a form row never staggers. */
export const selectSizeClasses = fieldSizeClasses;

export function selectClasses({
  size = "lg",
  invalid = false,
  className,
}: { size?: SelectSize; invalid?: boolean; className?: string } = {}): string {
  return cn(
    "w-full appearance-none border border-slate-200 bg-white pl-3.5 pr-10 font-semibold text-slate-900",
    radius.control,
    selectSizeClasses[size],
    "transition duration-150 motion-reduce:transition-none",
    fieldFocusRing,
    "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-50",
    invalid
      ? "border-danger-400 focus:border-danger-500 focus:ring-danger-500/10"
      : null,
    className,
  );
}

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

export const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  brand: "border-brand-500/15 bg-brand-50 text-brand-600",
  success: "border-success-200 bg-success-50 text-success-700",
  warning: "border-warning-200 bg-warning-50 text-warning-800",
  danger: "border-danger-200 bg-danger-50 text-danger-700",
};

export const badgeDotClasses: Record<BadgeTone, string> = {
  neutral: "bg-slate-400",
  brand: "bg-brand-500",
  success: "bg-success-600",
  warning: "bg-warning-500",
  danger: "bg-danger-600",
};

export function badgeClasses({
  tone = "neutral",
  className,
}: { tone?: BadgeTone; className?: string } = {}): string {
  return cn(
    "inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-bold leading-4",
    radius.control,
    badgeToneClasses[tone],
    className,
  );
}

export type SheetSize = "md" | "lg" | "full";

export const sheetSizeClasses: Record<SheetSize, string> = {
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  full: "h-[92dvh] sm:h-auto sm:max-w-2xl",
};

export function sheetPanelClasses({
  size = "md",
  className,
}: { size?: SheetSize; className?: string } = {}): string {
  return cn(
    "safe-area-bottom flex w-full max-h-[92dvh] flex-col overflow-hidden bg-white text-left shadow-2xl",
    "rounded-t-3xl sm:max-h-[86dvh] sm:rounded-3xl",
    "focus-visible:outline-none",
    sheetSizeClasses[size],
    className,
  );
}

export function skeletonClasses(className?: string): string {
  return cn(
    "animate-pulse rounded-md bg-slate-200/70 motion-reduce:animate-none",
    className,
  );
}
