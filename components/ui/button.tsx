import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    const variants = {
      primary: "bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500",
      secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400",
      ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400",
      danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
    };
    const sizes = {
      sm: "h-9 px-3 text-xs",
      md: "h-11 px-4 text-sm",
      lg: "h-12 px-5 text-sm",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
