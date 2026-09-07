"use client";

import { useActionState, useState } from "react";
import { signupAction } from "@/features/auth/actions";
import { initialAuthState } from "@/features/auth/types";
import { passwordConfirmationFeedback } from "@/features/auth/validation";
import { AuthField } from "@/components/auth/auth-field";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, initialAuthState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const confirmation = passwordConfirmationFeedback(password, confirmPassword);

  return (
    <form action={action} className="space-y-4">
      <AuthField label="Full name" name="fullName" autoComplete="name" placeholder="Ifeoma Adaeze" error={state.fieldErrors?.fullName} />
      <AuthField label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" error={state.fieldErrors?.email} />
      <AuthField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="At least 8 characters"
        revealable
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={state.fieldErrors?.password}
      />
      <AuthField
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        placeholder="Repeat your password"
        revealable
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={confirmation.error ?? state.fieldErrors?.confirmPassword}
        success={confirmation.success}
      />
      {state.error ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <Button variant="primary" size="lg" fullWidth loading={pending} loadingLabel="Creating account…">
        Create account
      </Button>
    </form>
  );
}
