"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/auth";
import { resolveActiveExamContext } from "./service";
export async function switchActiveExam(code: string) {
 const { supabase, user } = await requireOnboardedUser();
 const preference = await resolveActiveExamContext(supabase, user.id, code);
 (await cookies()).set("active-exam", `${user.id}:${preference.exam.code}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
 revalidatePath("/", "layout");
}
