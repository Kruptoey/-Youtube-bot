"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Cpu,
  ImageIcon,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { prettyModel } from "@/lib/ai-cost";

type VideoItem = {
  id: string;
  youtube_url: string;
  status: string;
  generated_title: string | null;
  generated_thumbnail_url: string | null;
  ai_cost_usd: number | null;
  ai_model: string | null;
  created_at: string;
  updated_at: string | null;
  error_message: string | null;
};

type Summary = {
  total: number;
  pending: number;
  completed: number;
  failed: number;
  successRate: number | null;
  costThisMonth: number;
};

const PAGE_SIZE = 20;

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "PENDING_APPROVAL", label: "รออนุมัติ" },
  { value: "COMPLETED", label: "สำเร็จ" },
  { value: "FAILED", label: "ล้มเหลว" },
];

// One source of truth for how each pipeline status reads in the UI.
const STATUS_META: Record<string, { label: string; pill: string; spin?: boolean }> = {
  DRAFT: { label: "กำลังเริ่ม", pill: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300", spin: true },
  EXTRACTING_AUDIO: { label: "กำลังถอดเสียง", pill: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300", spin: true },
  AI_ANALYZING: { label: "AI วิเคราะห์", pill: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300", spin: true },
  GENERATING_THUMBNAIL: { label: "สร้างปก", pill: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300", spin: true },
  UPLOADING_TO_YOUTUBE: { label: "กำลังอัปโหลด", pill: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300", spin: true },
  PENDING_APPROVAL: { label: "รออนุมัติ", pill: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  COMPLETED: { label: "สำเร็จ", pill: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" },
  FAILED: { label: "ล้มเหลว", pill: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, pill: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function fmtCost(n: number | null): string {
  if (n == null) return "—";
  return `$${Number(n).toFixed(3)}`;
}

// Action label + deep-link depend on status: completed jobs open straight into edit mode.
function actionFor(item: VideoItem): { label: string; href: string } {
  const base = `/dashboard/preview/${item.id}`;
  if (item.status === "PENDING_APPROVAL") return { label: "ตรวจ & อนุมัติ", href: base };
  if (item.status === "COMPLETED") return { label: "แก้ไข & ส่งใหม่", href: `${base}?edit=1` };
  if (item.status === "FAILED") return { label: "ดูรายละเอียด", href: base };
  return { label: "ดูสถานะ", href: base };
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function HistoryPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Avoid a stale slow response overwriting a newer one (race on fast typing/filtering).
  const reqIdRef = useRef(0);

  // Debounce the search box so we don't fire a request per keystroke. Resetting to
  // page 1 here runs inside the timeout callback (not the effect body), so it is not
  // a synchronous setState-in-effect.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Filter change also returns to the first page — done in the handler, not an effect.
  const selectStatus = useCallback((value: string) => {
    setStatus(value);
    setPage(1);
  }, []);

  const fetchList = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(`/api/videos?${params.toString()}`);
      const json = await res.json();
      if (myReq !== reqIdRef.current) return; // a newer request superseded this one
      if (!res.ok) {
        setError(json.error ?? "โหลดข้อมูลไม่สำเร็จ");
      } else {
        setItems(json.items ?? []);
        setTotal(json.total ?? 0);
      }
    } catch {
      if (myReq === reqIdRef.current) setError("เครือข่ายขัดข้อง");
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [page, status, debouncedSearch]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/videos/summary");
      if (res.ok) setSummary(await res.json());
    } catch {
      /* summary is non-critical — the cards just stay blank */
    }
  }, []);

  // Data fetching is the canonical effect; the brief loading flag these set is
  // intentional, so the set-state-in-effect guard is disabled for the fetch calls.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSummary();
  }, [fetchSummary]);

  const refreshAll = useCallback(() => {
    fetchList();
    fetchSummary();
  }, [fetchList, fetchSummary]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const metrics = useMemo(() => {
    if (!summary) return null;
    return {
      total: summary.total.toLocaleString(),
      cost: `$${summary.costThisMonth.toFixed(2)}`,
      success: summary.successRate == null ? "—" : `${Math.round(summary.successRate * 100)}%`,
      pending: summary.pending.toLocaleString(),
    };
  }, [summary]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">ประวัติงาน</h2>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          รีเฟรช
        </Button>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="งานทั้งหมด" value={metrics?.total ?? "—"} />
        <MetricCard label="ต้นทุน AI เดือนนี้" value={metrics?.cost ?? "—"} />
        <MetricCard label="อัตราสำเร็จ" value={metrics?.success ?? "—"} />
        <MetricCard
          label="รออนุมัติ"
          value={metrics?.pending ?? "—"}
          accent={summary && summary.pending > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="ค้นหาชื่อเรื่อง หรือ URL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={status === f.value ? "default" : "outline"}
              onClick={() => selectStatus(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="size-8 text-red-500" />
            <p className="text-muted-foreground">โหลดประวัติไม่สำเร็จ: {error}</p>
            <Button variant="outline" size="sm" onClick={fetchList}>
              <RefreshCw />
              ลองอีกครั้ง
            </Button>
          </CardContent>
        </Card>
      ) : loading && items.length === 0 ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="h-10 w-[68px] shrink-0 animate-pulse rounded-md bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Inbox className="size-10 opacity-60" />
            {debouncedSearch || status !== "all" ? (
              <p>ไม่พบงานที่ตรงกับเงื่อนไข</p>
            ) : (
              <>
                <p>ยังไม่มีงาน เริ่มงานแรกได้จากเมนู New Video</p>
                <Link href="/dashboard">
                  <Button size="sm">
                    <Sparkles />
                    สร้างงานใหม่
                  </Button>
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => {
            const meta = statusMeta(item.status);
            const action = actionFor(item);
            const title = item.generated_title || (item.status === "FAILED" ? item.youtube_url : "กำลังประมวลผล…");
            return (
              <Link key={item.id} href={action.href} className="group block">
                <Card className="transition-colors group-hover:ring-foreground/20">
                  <CardContent className="flex items-center gap-4 py-4">
                    {/* Thumbnail micro-preview */}
                    <div className="flex h-10 w-[68px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                      {item.generated_thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.generated_thumbnail_url}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget.style as CSSStyleDeclaration).display = "none";
                          }}
                        />
                      ) : item.status === "FAILED" ? (
                        <AlertTriangle className="size-4 text-red-500" />
                      ) : (
                        <ImageIcon className="size-4 text-muted-foreground" />
                      )}
                    </div>

                    {/* Title + meta */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1" title={new Date(item.created_at).toLocaleString()}>
                          <Clock className="size-3" />
                          {timeAgo(item.created_at)}
                        </span>
                        {item.ai_model && (
                          <span className="inline-flex items-center gap-1">
                            <Cpu className="size-3" />
                            {prettyModel(item.ai_model)}
                          </span>
                        )}
                        {item.ai_cost_usd != null && (
                          <span className="inline-flex items-center gap-1">
                            <Coins className="size-3" />
                            {fmtCost(item.ai_cost_usd)}
                          </span>
                        )}
                        {item.status === "FAILED" && item.error_message && (
                          <span className="truncate text-red-500" title={item.error_message}>
                            {item.error_message}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status pill */}
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${meta.pill}`}>
                      {meta.spin && <Loader2 className="size-3 animate-spin" />}
                      {meta.label}
                    </span>

                    {/* Action affordance */}
                    <span className="hidden shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground group-hover:text-foreground sm:inline-flex">
                      {action.label}
                      <ChevronRight className="size-4" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!error && total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {rangeStart}–{rangeEnd} จาก {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft />
              ก่อนหน้า
            </Button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              ถัดไป
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
