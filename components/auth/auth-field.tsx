import type { InputHTMLAttributes } from "react";

export function AuthField({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-slate-700">{label}</span>
      <input
        {...props}
        aria-invalid={Boolean(error)}
        className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-100"
      />
      {error ? <span className="mt-1.5 block text-xs font-semibold text-red-600">{error}</span> : null}
    </label>
  );
}
