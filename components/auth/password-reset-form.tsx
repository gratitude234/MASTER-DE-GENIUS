"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, updatePasswordAction } from "@/features/auth/actions";
import { initialAuthState } from "@/features/auth/types";
import { AuthField } from "@/components/auth/auth-field";

export function RequestPasswordResetForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialAuthState);
  return (
    <form action={action} className="space-y-4">
      <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" error={state.fieldErrors?.email} />
      {state.error ? <div className="rounded-xl bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700">{state.error}</div> : null}
      <button disabled={pending} className="h-12 w-full rounded-xl bg-slate-950 text-sm font-extrabold text-white disabled:opacity-60">{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initialAuthState);
  return (
    <form action={action} className="space-y-4">
      <AuthField label="New password" name="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" error={state.fieldErrors?.password} />
      <AuthField label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" placeholder="Repeat your password" error={state.fieldErrors?.confirmPassword} />
      {state.error ? <div className="rounded-xl bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700">{state.error}</div> : null}
      <button disabled={pending} className="h-12 w-full rounded-xl bg-brand-500 text-sm font-extrabold text-white disabled:opacity-60">{pending ? "Updating…" : "Update password"}</button>
    </form>
  );
}
