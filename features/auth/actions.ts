"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthActionState } from "@/features/auth/types";
import { safeNextPath, validateEmail, validatePassword } from "@/features/auth/validation";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function appOrigin() {
  const headerStore = await headers();
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

export async function loginAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = formString(formData, "email").toLowerCase();
  const password = formString(formData, "password");
  const next = safeNextPath(formData.get("next"), "/home");

  const emailError = validateEmail(email);
  const passwordError = validatePassword(password);
  if (emailError || passwordError) {
    return { fieldErrors: { email: emailError ?? undefined, password: passwordError ?? undefined } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "We couldn't sign you in with those details." };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session could not be started. Please try again." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

  redirect(profile?.onboarding_completed ? next : "/onboarding");
}

export async function signupAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const fullName = formString(formData, "fullName");
  const email = formString(formData, "email").toLowerCase();
  const password = formString(formData, "password");
  const confirmPassword = formString(formData, "confirmPassword");

  const fieldErrors: AuthActionState["fieldErrors"] = {};
  if (fullName.length < 2) fieldErrors.fullName = "Tell us your name.";
  const emailError = validateEmail(email);
  if (emailError) fieldErrors.email = emailError;
  const passwordError = validatePassword(password);
  if (passwordError) fieldErrors.password = passwordError;
  if (password !== confirmPassword) fieldErrors.confirmPassword = "Passwords do not match.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const origin = await appOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });

  if (error) {
    return { error: error.message.includes("already") ? "An account with this email may already exist." : "We couldn't create your account. Please try again." };
  }

  if (data.session) redirect("/onboarding");
  redirect(`/check-email?email=${encodeURIComponent(email)}`);
}

export async function requestPasswordResetAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = formString(formData, "email").toLowerCase();
  const emailError = validateEmail(email);
  if (emailError) return { fieldErrors: { email: emailError } };

  const supabase = await createClient();
  const origin = await appOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) return { error: "We couldn't send a reset link right now." };
  redirect(`/check-email?mode=reset&email=${encodeURIComponent(email)}`);
}

export async function updatePasswordAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const password = formString(formData, "password");
  const confirmPassword = formString(formData, "confirmPassword");
  const passwordError = validatePassword(password);
  if (passwordError || password !== confirmPassword) {
    return {
      fieldErrors: {
        password: passwordError ?? undefined,
        confirmPassword: password !== confirmPassword ? "Passwords do not match." : undefined,
      },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "We couldn't update your password. Open the latest reset link and try again." };
  redirect("/login?password=updated");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
