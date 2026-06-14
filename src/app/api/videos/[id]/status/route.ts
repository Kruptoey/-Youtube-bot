import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/api-auth";

// Server-side status poll — uses the service-role key so RLS never blocks it.
// The browser Supabase client relies on a valid user JWT; if the cookie is stale
// or missing, the browser query silently returns 0 rows. Fetching via this route
// instead guarantees the frontend always sees the live record. Because it bypasses
// RLS, the route gates itself on a valid session (proxy.ts only covers /dashboard).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireUser(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("videos")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
