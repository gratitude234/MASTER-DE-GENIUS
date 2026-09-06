import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { MISSING_PUBLIC_CONFIG, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

export function createClient() {
  const url = supabaseUrl();
  const key = supabasePublishableKey();

  if (!url || !key) {
    throw new Error(MISSING_PUBLIC_CONFIG);
  }

  return createBrowserClient<Database>(url, key);
}
