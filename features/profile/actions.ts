"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

export type ProfileActionState = { error?: string; success?: string };

export async function updateProfileAction(_previous: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (fullName.length < 2 || fullName.length > 80) return { error: "Enter a name between 2 and 80 characters." };

  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
  if (error) return { error: "We couldn't update your profile." };

  revalidatePath("/me");
  revalidatePath("/home");
  return { success: "Profile updated." };
}
