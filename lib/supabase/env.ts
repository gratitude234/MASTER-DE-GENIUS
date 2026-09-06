/**
 * Supabase renamed its API keys: anon -> publishable, service_role -> secret.
 * Both naming schemes are accepted so existing deployments keep working.
 */
export function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function supabasePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function supabaseSecretKey() {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export const MISSING_PUBLIC_CONFIG =
  "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
