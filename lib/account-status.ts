import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseSecretKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Whether an admin has suspended this account.
 *
 * Read through the service role: `account_suspensions` is invisible to the
 * browser role, so a student can neither read nor clear their own suspension.
 *
 * Fails open. A suspension lookup that cannot complete must not sign every
 * student out of the product; the Supabase Auth ban applied alongside the
 * record still refuses the suspended account new sessions.
 */
export const isAccountSuspended = cache(async (userId: string): Promise<boolean> => {
  if (!supabaseUrl() || !supabaseSecretKey()) return false;

  try {
    const { data, error } = await createAdminClient()
      .from("account_suspensions")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error(`[auth] suspension lookup failed: ${error.code ?? "unknown"}`);
      return false;
    }
    return Boolean(data);
  } catch {
    console.error("[auth] suspension lookup failed");
    return false;
  }
});
