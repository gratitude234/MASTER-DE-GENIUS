import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges a Supabase auth code for a session.
 *
 * Signup no longer routes through here: email confirmation is disabled, so
 * signUp returns a session directly. This route is still required by password
 * recovery (resetPasswordForEmail sends the user to /auth/callback?next=/reset-password)
 * and stays generic so OAuth, magic links, or re-enabled email confirmation
 * would work without change. It carries no signup-specific logic.
 */

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/home";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (!code) return NextResponse.redirect(new URL("/login?auth=invalid", url.origin));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?auth=invalid", url.origin));

  return NextResponse.redirect(new URL(next, url.origin));
}
