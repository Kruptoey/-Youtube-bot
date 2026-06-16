import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/api-auth";

// Aggregate metrics for the History header cards. Counts use head-only queries (no
// rows transferred); the month's spend sums just the ai_cost_usd column for the
// current month. Service-role + session guard, same as the list route.
function countWhere(filter?: { col: string; val: string }) {
  let q = supabaseAdmin.from("videos").select("id", { count: "exact", head: true });
  if (filter) q = q.eq(filter.col, filter.val);
  return q;
}

export async function GET(req: NextRequest) {
  const unauthorized = await requireUser(req);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const [totalRes, pendingRes, completedRes, failedRes, monthCostRes] = await Promise.all([
    countWhere(),
    countWhere({ col: "status", val: "PENDING_APPROVAL" }),
    countWhere({ col: "status", val: "COMPLETED" }),
    countWhere({ col: "status", val: "FAILED" }),
    supabaseAdmin.from("videos").select("ai_cost_usd").gte("created_at", monthStart),
  ]);

  // The count queries are essential; a real failure there is a 500. The month-cost
  // query can fail benignly before the history-v2 migration adds ai_cost_usd — in
  // that case we just report $0 spend rather than breaking the whole header.
  const countError = totalRes.error || pendingRes.error || completedRes.error || failedRes.error;
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const completed = completedRes.count ?? 0;
  const failed = failedRes.count ?? 0;
  const finished = completed + failed;

  const costThisMonth = monthCostRes.error
    ? 0
    : (monthCostRes.data ?? []).reduce((sum, r) => sum + (Number(r.ai_cost_usd) || 0), 0);

  return NextResponse.json({
    total: totalRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    completed,
    failed,
    // Share of finished jobs that succeeded; null until at least one has finished.
    successRate: finished > 0 ? completed / finished : null,
    costThisMonth: Math.round((costThisMonth + Number.EPSILON) * 1e4) / 1e4,
  });
}
