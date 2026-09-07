"use client";

import { useActionState } from "react";
import { updateProfileAction, type ProfileActionState } from "@/features/profile/actions";
import { AuthField } from "@/components/auth/auth-field";
import { Button } from "@/components/ui/button";

const initialState: ProfileActionState = {};

export function ProfileNameForm({ fullName }: { fullName: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);

  return (
    <form action={action} className="space-y-3">
      {/*
        The same field component the auth screens use, so the one text input in
        the profile does not drift into its own chrome. It also carries the
        label/error association this form was missing.
      */}
      <AuthField
        label="Full name"
        name="fullName"
        autoComplete="name"
        defaultValue={fullName}
        error={state.error}
        success={state.success}
      />
      {/* No `type`: this is the form's submit control. */}
      <Button variant="dark" size="md" loading={pending} loadingLabel="Saving profile…">
        Save profile
      </Button>
    </form>
  );
}
