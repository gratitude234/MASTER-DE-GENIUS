import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("onboarding_completed").eq("id", user.id).maybeSingle();
  redirect(profile?.onboarding_completed ? "/home" : "/onboarding");
}
