import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/api-auth";

// Server-side history list — uses the service-role key so RLS never silently returns
// 0 rows when the browser's auth cookie is stale (the same failure mode that broke
// the preview poll). Because it bypasses RLS it gates on a valid session first.
//
// Query params: q (search title/url), status (filter, "all" = no filter),
// page (1-based), pageSize. Returns { items, total, page, pageSize }.
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Cost columns (ai_cost_usd, ai_model) only exist once the history-v2 migration has
// run. We select them when present and transparently fall back to the base columns
// otherwise, so History keeps working before the migration (cost just shows blank).
const BASE_FIELDS =
  "id, youtube_url, status, generated_title, generated_thumbnail_url, created_at, updated_at, error_message";
const LIST_FIELDS = `${BASE_FIELDS}, ai_cost_usd, ai_model`;

// Postgres "undefined column" — what we get when the v2 migration hasn't run yet.
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42703" || /ai_cost_usd|ai_model/.test(error.message ?? ""));
}

export async function GET(req: NextRequest) {
  const unauthorized = await requireUser(req);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim() || "all";
  // Strip characters that have meaning in PostgREST's or()/ilike filter grammar so a
  // user's raw input can never alter the query shape.
  const q = (searchParams.get("q") || "").replace(/[,()%*\\]/g, "").trim();

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const runQuery = (fields: string) => {
    let query = supabaseAdmin
      .from("videos")
      .select(fields, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (status !== "all") query = query.eq("status", status);
    if (q) query = query.or(`generated_title.ilike.%${q}%,youtube_url.ilike.%${q}%`);
    return query;
  };

  let { data, error, count } = await runQuery(LIST_FIELDS);
  if (isMissingColumn(error)) {
    ({ data, error, count } = await runQuery(BASE_FIELDS));
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [], total: count ?? 0, page, pageSize });
}
