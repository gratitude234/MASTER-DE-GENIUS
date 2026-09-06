import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { MISSING_PUBLIC_CONFIG, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

export async function createClient() {
  const cookieStore = await cookies();
  const url = supabaseUrl();
  const key = supabasePublishableKey();

  if (!url || !key) {
    throw new Error(MISSING_PUBLIC_CONFIG);
  }

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always mutate cookies. Middleware refreshes sessions.
        }
      },
    },
  });
}
