"use client";

import { useActionState } from "react";
import { signupAction } from "@/features/auth/actions";
import { initialAuthState } from "@/features/auth/types";
import { AuthField } from "@/components/auth/auth-field";

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, initialAuthState);

  return (
    <form action={action} className="space-y-4">
      <AuthField label="Full name" name="fullName" autoComplete="name" placeholder="Ifeoma Adaeze" error={state.fieldErrors?.fullName} />
      <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" error={state.fieldErrors?.email} />
      <AuthField label="Password" name="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" error={state.fieldErrors?.password} />
      <AuthField label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password" placeholder="Repeat your password" error={state.fieldErrors?.confirmPassword} />
      {state.error ? <div className="rounded-xl bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700">{state.error}</div> : null}
      <button disabled={pending} className="flex h-12 w-full items-center justify-center rounded-xl bg-brand-500 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:opacity-60">
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
