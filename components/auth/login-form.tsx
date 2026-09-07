"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/features/auth/actions";
import { initialAuthState } from "@/features/auth/types";
import { AuthField } from "@/components/auth/auth-field";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";

export function LoginForm({ nextPath = "/home" }: { nextPath?: string }) {
  const [state, action, pending] = useActionState(loginAction, initialAuthState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />
      <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" error={state.fieldErrors?.email} />
      <AuthField label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" revealable error={state.fieldErrors?.password} />
      <div className="-mt-1 flex justify-end">
        <Link href="/forgot-password" className="inline-flex min-h-11 items-center rounded text-xs font-bold text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">Forgot password?</Link>
      </div>
      {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <Button variant="dark" size="lg" fullWidth loading={pending} loadingLabel="Signing in…">
        Sign in
      </Button>
    </form>
  );
}
