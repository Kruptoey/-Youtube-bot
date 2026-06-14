import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for trusted operations (API routes, Inngest workers).
 *
 * It uses the SERVICE_ROLE key, which bypasses Row Level Security, so it must
 * NEVER be imported into a Client Component or exposed to the browser. The key is
 * read from a non-`NEXT_PUBLIC_` env var precisely so it is never bundled client-side.
 *
 * If the service-role key is absent (e.g. local dev that hasn't set it yet) we fall
 * back to the anon key and warn loudly. This preserves today's behavior instead of
 * breaking, but writes may be rejected by RLS until the service-role key is provided.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!serviceRoleKey) {
  console.warn(
    "[supabase-admin] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key. " +
      "Server-side writes may be blocked by RLS. Set it before deploying to production."
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey || anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
