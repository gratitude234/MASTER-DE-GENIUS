import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
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
