import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Auth guard for API route handlers.
 *
 * `src/proxy.ts` only guards `/dashboard/*`, so route handlers under `/api` are
 * otherwise public. These routes use the service-role client (which bypasses RLS),
 * so they MUST confirm a valid logged-in session before doing any work — otherwise
 * anyone on the internet could read or mutate records by guessing an id.
 *
 * Returns `null` when the request is authenticated, or a ready-to-return 401
 * `NextResponse` when it is not:
 *
 *   const unauthorized = await requireUser(req);
 *   if (unauthorized) return unauthorized;
 *
 * `getUser()` validates the JWT with Supabase — never trust `getSession()` on the
 * server. Cookie writes are a no-op here: this is a read-only check, and the proxy
 * already refreshes the session cookie during dashboard navigation.
 */
export async function requireUser(req: NextRequest): Promise<NextResponse | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {
          /* read-only guard — nothing to persist */
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
