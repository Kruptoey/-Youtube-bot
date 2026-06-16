import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { BRAND_KIT } from "./brand";
import type { ThumbnailBrief } from "./brief";
import { swapFace } from "./faceswap";
import type { AiCost } from "@/lib/ai-cost";

const STORAGE_BUCKET = "assets"; // reuse the existing bucket; no new bucket to provision
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

/** Fetch a remote image and return it as base64 + mime, or null on any failure. */
async function fetchAsInlineData(
  url: string
): Promise<{ mimeType: string; data: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mimeType = r.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await r.arrayBuffer());
    return { mimeType, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

/**
 * Build the image prompt. The single most important instruction is "NO text" —
 * we never let the diffusion model render (and misspell) Thai; the compositor
 * overlays crisp, deterministic text afterwards.
 */
function buildImagePrompt(brief: ThumbnailBrief, brandDna: string): string {
  const side = brief.layout === "subject-left" ? "LEFT" : "RIGHT";
  return [
    "Create a 16:9 YouTube thumbnail composition: a cinematic background scene WITH the subject person.",
    "ABSOLUTELY NO text, NO letters, NO numbers spelled as words, NO logos, NO watermarks anywhere in the image.",
    `Brand style: ${BRAND_KIT.styleGuide}`,
    brandDna ? `Channel brand notes: ${brandDna}` : "",
    `Scene: ${brief.scene}.`,
    "Subject: the exact same person shown in the reference image — keep an identical face and likeness; " +
      `${brief.subject_pose}.`,
    `Composition: place the subject on the ${side} third of the frame; keep the opposite side visually clean and uncluttered so graphic text can be added later.`,
    `Colour palette: ${brief.color_palette.join(", ")}.`,
    "Lighting: dramatic cinematic rim light, glowing accents, very high contrast, premium look.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generate a scene image with Gemini's native image model via the REST API.
 *
 * We call REST directly (instead of an SDK helper) because the installed
 * @google/generative-ai version predates image output, and REST is version-stable.
 * On a 4xx we retry once with the broader ["TEXT","IMAGE"] modality set, which some
 * model revisions require.
 */
async function generateSceneImageGemini(
  prompt: string,
  refUrls: string[]
): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const url of refUrls) {
    const inline = await fetchAsInlineData(url);
    if (inline) parts.push({ inlineData: inline });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`;

  const call = async (modalities: string[], withImageConfig: boolean): Promise<Response> =>
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: modalities,
          // 16:9 is important for YouTube; the prompt also states it, so dropping
          // imageConfig on the fallback (for model revisions that reject the field)
          // still produces a usable image.
          ...(withImageConfig ? { imageConfig: { aspectRatio: "16:9" } } : {}),
        },
      }),
    });

  let res = await call(["IMAGE"], true);
  if (res.status >= 400 && res.status < 500) {
    res = await call(["TEXT", "IMAGE"], false);
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Gemini image gen failed (${res.status}): ${msg.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> };
    }>;
  };
  const candParts = json.candidates?.[0]?.content?.parts ?? [];
  for (const p of candParts) {
    const data = p.inlineData?.data ?? p.inline_data?.data;
    if (data) return Buffer.from(data, "base64");
  }
  throw new Error("Gemini returned no image data.");
}

/**
 * Generate a scene image with OpenAI's gpt-image-1 (the engine behind ChatGPT image
 * generation). When a reference image is supplied we use the /images/edits endpoint
 * so the presenter's face is preserved; otherwise /images/generations. gpt-image-1
 * always returns base64. 1536x1024 is the closest landscape size; the compositor
 * crops it to 16:9.
 */
async function generateSceneImageOpenAI(prompt: string, refUrls: string[]): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  const model = OPENAI_IMAGE_MODEL;
  const size = "1536x1024";

  const readB64 = (json: { data?: Array<{ b64_json?: string }> }): Buffer => {
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI returned no image data.");
    return Buffer.from(b64, "base64");
  };

  // With a reference image, edit it so the same person/style carries over.
  if (refUrls.length > 0) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", size);
    let appended = 0;
    for (const url of refUrls.slice(0, 2)) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        form.append("image[]", await r.blob(), `ref${appended}.png`);
        appended++;
      } catch {
        /* skip unreadable reference */
      }
    }
    if (appended > 0) {
      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) {
        throw new Error(`OpenAI image edit failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      }
      return readB64(await res.json());
    }
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI image gen failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return readB64(await res.json());
}

/**
 * Provider-agnostic scene generation.
 *
 * THUMBNAIL_IMAGE_PROVIDER = "gemini" | "openai" | "auto" (default).
 * In "auto" we prefer Gemini (cheapest) and fall back to gpt-image-1 on ANY failure
 * — notably the free-tier 429 on Gemini's image model — so the pipeline works out of
 * the box with an OpenAI key and gets cheaper automatically once Gemini billing is on.
 */
export async function generateSceneImage(
  prompt: string,
  refUrls: string[]
): Promise<{ buf: Buffer; model: string }> {
  const provider = (process.env.THUMBNAIL_IMAGE_PROVIDER || "auto").toLowerCase();
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (provider === "openai") {
    return { buf: await generateSceneImageOpenAI(prompt, refUrls), model: OPENAI_IMAGE_MODEL };
  }
  if (provider === "gemini") {
    return { buf: await generateSceneImageGemini(prompt, refUrls), model: IMAGE_MODEL };
  }

  if (hasGemini) {
    try {
      return { buf: await generateSceneImageGemini(prompt, refUrls), model: IMAGE_MODEL };
    } catch (e) {
      if (!hasOpenAI) throw e;
      console.warn(
        "[thumbnail] Gemini image gen failed, falling back to gpt-image-1:",
        (e as Error).message
      );
    }
  }
  return { buf: await generateSceneImageOpenAI(prompt, refUrls), model: OPENAI_IMAGE_MODEL };
}

/** Upload a PNG buffer to the assets bucket under thumbnails/<sub>/ and return its public URL. */
export async function uploadThumbToStorage(
  buf: Buffer,
  sub: string
): Promise<{ publicUrl: string; storagePath: string }> {
  const storagePath = `thumbnails/${sub}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.png`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buf, { contentType: "image/png", upsert: false });
  if (error) throw new Error("Scene upload failed: " + error.message);
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl, storagePath };
}

/** Most recent reusable background for a scene archetype (brand-curated first). */
async function findLibraryBackground(sceneTag: string): Promise<string | null> {
  const { data } = await supabase
    .from("thumbnail_backgrounds")
    .select("public_url")
    .eq("scene_tag", sceneTag)
    .order("is_brand", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.public_url ?? null;
}

export interface ResolveSceneOptions {
  qualityMode?: string;
  refUrls: string[];
  brandDna: string;
  /** Force a fresh generation (used on QC retries). */
  forceCustom?: boolean;
  /** Real presenter face URL — when set (and FAL_KEY present), the generated face is
   *  swapped for this exact identity. */
  faceSourceUrl?: string | null;
  /** Optional cost accumulator — records the per-image spend when a fresh scene is generated. */
  cost?: AiCost;
}

/**
 * Resolve the scene image URL for a brief — the cost-control heart of the design.
 *
 * Ordinary lessons reuse a brand Background from the Library (cost ≈ $0). Only
 * "hero" videos (needs_custom_scene), Maximize mode, or QC retries generate a
 * fresh scene — which is then saved back into the Library so it grows over time.
 */
export async function resolveScene(
  brief: ThumbnailBrief,
  opts: ResolveSceneOptions
): Promise<{ url: string; source: "library" | "generated" }> {
  const mustGenerate =
    opts.forceCustom || brief.needs_custom_scene || opts.qualityMode === "Maximize";

  if (!mustGenerate) {
    const reused = await findLibraryBackground(brief.scene_tag);
    if (reused) return { url: reused, source: "library" };
  }

  const prompt = buildImagePrompt(brief, opts.brandDna);
  const { buf: generated, model: imageModel } = await generateSceneImage(prompt, opts.refUrls);
  let buf = generated;
  opts.cost?.addImage("thumbnail:scene", imageModel);

  // Exact-identity layer: swap the AI-rendered face for the real presenter's face.
  // Best-effort — keep the generated face if FAL_KEY is absent or the swap fails.
  if (process.env.FAL_KEY && opts.faceSourceUrl) {
    try {
      buf = await swapFace(buf, opts.faceSourceUrl);
    } catch (e) {
      console.warn("[thumbnail] face-swap failed, keeping generated face:", (e as Error).message);
    }
  }

  const { publicUrl, storagePath } = await uploadThumbToStorage(buf, "scenes");

  // Grow the Library for future reuse (best-effort — never block on this).
  await supabase
    .from("thumbnail_backgrounds")
    .insert({
      scene_tag: brief.scene_tag,
      prompt,
      public_url: publicUrl,
      storage_path: storagePath,
      palette: brief.color_palette,
    })
    .then(
      () => {},
      () => {}
    );

  return { url: publicUrl, source: "generated" };
}
