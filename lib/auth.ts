import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAccountSuspended } from "@/lib/account-status";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  // A suspended account can hold a still-valid token for a while after the Auth
  // ban; the pages stop serving it immediately rather than when it expires.
  if (await isAccountSuspended(user.id)) {
    redirect("/suspended");
  }

  return { supabase, user };
}

export async function requireOnboardedUser() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.onboarding_completed) {
    redirect("/onboarding");
  }

  return { supabase, user, profile };
}
