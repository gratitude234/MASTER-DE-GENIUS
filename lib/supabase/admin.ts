import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { supabaseSecretKey, supabaseUrl } from "@/lib/supabase/env";

export function createAdminClient() {
  const url = supabaseUrl();
  const serviceRoleKey = supabaseSecretKey();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Server question access requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
