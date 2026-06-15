/**
 * Face-swap step (fal.ai) — the "exact face" layer.
 *
 * The scene model (gpt-image-1 / Gemini) gives us dynamic outfits + poses but only a
 * *similar* face. We then transplant the REAL presenter's face onto that render so the
 * identity is ~96-99% exact while keeping the AI-generated outfit/pose/scene.
 *
 * Provider: fal.ai (simple REST, fast, cheap). Model id is env-overridable. The whole
 * step is OPTIONAL and best-effort: with no FAL_KEY (or on any failure) the caller
 * keeps the un-swapped render, so the pipeline never breaks over face-swap.
 */
const FACESWAP_MODEL = process.env.FAL_FACESWAP_MODEL || "fal-ai/face-swap";

export function faceSwapEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

export async function swapFace(targetPng: Buffer, sourceFaceUrl: string): Promise<Buffer> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set.");

  // The generated render is passed inline as a data URI; the real face is a public URL.
  const targetDataUri = `data:image/png;base64,${targetPng.toString("base64")}`;

  const res = await fetch(`https://fal.run/${FACESWAP_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // fal face-swap accepts both the base (target) and swap (source-face) images.
      // Field names vary slightly between models; we send the common aliases.
      base_image_url: targetDataUri,
      swap_image_url: sourceFaceUrl,
      target_image_url: targetDataUri,
      source_image_url: sourceFaceUrl,
    }),
  });

  if (!res.ok) {
    throw new Error(`fal face-swap failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  // Result url location is model-dependent — probe the common shapes.
  const url =
    (json.image as { url?: string })?.url ??
    (json.images as Array<{ url?: string }>)?.[0]?.url ??
    ((json.output as Array<{ url?: string }>)?.[0]?.url) ??
    (typeof json.output === "string" ? (json.output as string) : undefined);

  if (!url) throw new Error("fal face-swap returned no image url.");

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not fetch swapped image (${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}
