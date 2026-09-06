"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/features/auth/actions";
import { initialAuthState } from "@/features/auth/types";
import { AuthField } from "@/components/auth/auth-field";

export function LoginForm({ nextPath = "/home" }: { nextPath?: string }) {
  const [state, action, pending] = useActionState(loginAction, initialAuthState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />
      <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" error={state.fieldErrors?.email} />
      <AuthField label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" error={state.fieldErrors?.password} />
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-xs font-bold text-brand-500 hover:text-brand-600">Forgot password?</Link>
      </div>
      {state.error ? <div className="rounded-xl bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700">{state.error}</div> : null}
      <button disabled={pending} className="flex h-12 w-full items-center justify-center rounded-xl bg-slate-950 text-sm font-extrabold text-white transition hover:bg-slate-800 disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
