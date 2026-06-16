import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { buildThumbnailBrief, type ThumbnailBrief } from "./brief";
import { resolveScene } from "./scene";
import { qcThumbnail, type QcResult } from "./qc";
import { loadBrandDna, getDefaultSubjectRef } from "./brand";
import type { AiCost } from "@/lib/ai-cost";

export interface ProduceThumbnailInput {
  videoId: string;
  transcript: string;
  analyst: { core_value?: string; target_audience?: string; pain_points?: string[] };
  thumbnailText: string;
  title: string;
  directorsNote?: string;
  qualityMode?: string;
  /** Optional per-video reference image (style or subject) uploaded by the user. */
  refUrl?: string | null;
  /** Optional cost accumulator — records brief/scene/QC spend for this thumbnail run. */
  cost?: AiCost;
}

/** Render the final composite through the Satori /api/og route and return PNG bytes. */
async function renderComposite(videoId: string): Promise<Buffer> {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  // Bound the request so a slow font/scene fetch inside /api/og can't hang the step.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(`${base}/api/og?videoId=${videoId}&v=${Date.now()}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Composite render failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The thumbnail orchestrator — Art Director → scene → composite → QC, with an
 * auto-retry loop that regenerates on QC failure.
 *
 * Designed to DEGRADE GRACEFULLY: any unrecoverable failure simply leaves the
 * scene/brief fields unset, and /api/og falls back to the legacy template, so the
 * video pipeline is never blocked by thumbnail trouble. Callers should treat a
 * throw from here as non-fatal.
 */
export async function produceThumbnail(input: ProduceThumbnailInput): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[thumbnail] GEMINI_API_KEY not set — skipping AI thumbnail, using template fallback.");
    return;
  }

  const [brandDna, subjectRef] = await Promise.all([
    loadBrandDna().catch(() => ""),
    getDefaultSubjectRef().catch(() => null),
  ]);
  const refUrls = [input.refUrl, subjectRef].filter((u): u is string => !!u);

  // 1. Art Director brief (persist immediately so /api/og can read text_layers).
  const brief: ThumbnailBrief = await buildThumbnailBrief(
    {
      transcript: input.transcript,
      analyst: input.analyst,
      thumbnailText: input.thumbnailText,
      title: input.title,
      directorsNote: input.directorsNote,
      brandDna,
      qualityMode: input.qualityMode,
    },
    input.cost
  );
  await supabase.from("videos").update({ thumbnail_brief: brief }).eq("id", input.videoId);

  // 2. Generate → composite → QC, retrying on QC failure.
  const maxAttempts = input.qualityMode === "Maximize" ? 3 : 2;
  let lastIssues: string[] = [];
  let qc: QcResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Retries fold the previous QC issues into the scene prompt and force a fresh gen.
    const attemptBrief: ThumbnailBrief =
      lastIssues.length > 0
        ? { ...brief, scene: `${brief.scene}. Fix from previous attempt: ${lastIssues.join("; ")}.` }
        : brief;

    let sceneUrl: string;
    try {
      const r = await resolveScene(attemptBrief, {
        qualityMode: input.qualityMode,
        refUrls,
        brandDna,
        cost: input.cost,
        forceCustom: attempt > 1,
        // Swap in the real presenter's face for exact identity (the user's optional
        // reference wins, otherwise the default Kruptoey photo).
        faceSourceUrl: input.refUrl || subjectRef,
      });
      sceneUrl = r.url;
    } catch (e) {
      console.error("[thumbnail] scene generation failed (degrading to template):", e);
      return; // graceful: /api/og falls back to the legacy template
    }
    await supabase
      .from("videos")
      .update({ generated_thumbnail_scene_url: sceneUrl })
      .eq("id", input.videoId);

    let png: Buffer;
    try {
      png = await renderComposite(input.videoId);
    } catch (e) {
      console.error("[thumbnail] composite render failed (degrading):", e);
      return;
    }

    try {
      qc = await qcThumbnail(new Uint8Array(png), brief, input.cost);
    } catch (e) {
      // QC is a safety net, not a gate — if it errors, accept the render.
      console.error("[thumbnail] QC errored, accepting current render:", e);
      qc = { pass: true, legible: true, face_ok: true, balanced: true, issues: ["qc_skipped"] };
    }

    if (qc.pass) break;
    lastIssues = qc.issues ?? [];
    console.warn(`[thumbnail] QC failed attempt ${attempt}/${maxAttempts}:`, lastIssues);
  }

  // 3. Record the result. The live composite is served by /api/og; the cache-busted
  //    URL is stored for the preview UI and history.
  await supabase
    .from("videos")
    .update({
      generated_thumbnail_url: `/api/og?videoId=${input.videoId}&v=${Date.now()}`,
      thumbnail_qc: qc,
    })
    .eq("id", input.videoId);
}
