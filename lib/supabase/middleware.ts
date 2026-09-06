import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

const protectedPrefixes = ["/home", "/practice", "/mock", "/progress", "/me", "/exam", "/onboarding"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = supabaseUrl();
  const key = supabasePublishableKey();

  if (!url || !key) {
    return response;
  }

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isProtected = protectedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
