"use client";

import { useActionState } from "react";
import { updateProfileAction, type ProfileActionState } from "@/features/profile/actions";

const initialState: ProfileActionState = {};

export function ProfileNameForm({ fullName }: { fullName: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);
  return (
    <form action={action} className="space-y-3">
      <label className="block"><span className="text-xs font-bold text-slate-600">Full name</span><input name="fullName" defaultValue={fullName} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3.5 text-sm outline-none focus:border-brand-500" /></label>
      {state.error ? <p className="text-xs font-semibold text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-xs font-semibold text-emerald-700">{state.success}</p> : null}
      <button disabled={pending} className="h-10 rounded-xl bg-slate-950 px-4 text-xs font-extrabold text-white disabled:opacity-60">{pending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}
