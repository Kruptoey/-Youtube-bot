import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client used by Client Components.
 *
 * Unlike the plain `createClient`, `createBrowserClient` from `@supabase/ssr`
 * persists the auth session in COOKIES instead of localStorage. This is what lets
 * `src/middleware.ts` (which runs on the server/edge) read the session and guard
 * the dashboard routes. The public API (`auth`, `from`, `storage`, ...) is identical
 * to the previous client, so existing imports keep working unchanged.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
