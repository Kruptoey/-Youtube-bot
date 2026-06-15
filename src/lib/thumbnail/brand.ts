import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

/**
 * STATIC brand frame for thumbnails.
 *
 * This is the "channel identity" half of the design: things that must stay
 * constant across every video so the channel stays recognizable (see
 * docs/thumbnail-ai-design.md §3 "Dynamic content on a static brand frame").
 * The Art Director fills in the DYNAMIC half (scene details, pose, emphasis
 * words) on top of this.
 */
export const BRAND_KIT = {
  name: "Eazy Cal",
  logoText: "Eazy Cal",
  // Brand palette: magenta / yellow / cyan / red + dark navy + white. Used as a
  // default for the Art Director and as the compositor's fallback text colours.
  palette: ["#E6007E", "#FFD400", "#00E5FF", "#FF3B30", "#0A1A3F", "#FFFFFF"],
  // The signature look the image model must always honour.
  styleGuide:
    "High-energy, high-CTR Thai exam-prep YouTube thumbnail for the 'Eazy Cal' channel. " +
    "The presenter is a friendly, expressive male tutor wearing an Eazy Cal branded t-shirt " +
    "(often bright pink/magenta), with an engaging pose — a big confident smile while pointing, " +
    "or a surprised 'this is important!' look. The background is PACKED with topic-specific " +
    "handwritten math relevant to the lesson (glowing equations, integrals, derivatives, graphs, " +
    "3D coordinate diagrams) plus colourful doodle accents and the occasional curiosity emoji " +
    "(🤔😮). Backgrounds may be bright and energetic or dramatic dark with neon-glowing equations. " +
    "Very high contrast, punchy and clickable, exam-pressure energy.",
  // Default headline/sub colours when the Art Director does not override them.
  headlineFill: "#FFD400",
  headlineStroke: "#0A0A0A",
  subFill: "#FFFFFF",
  subStroke: "#0A0A0A",
} as const;

/**
 * Optional free-text "Brand DNA" the user can save in Settings. Stored as a JSON
 * blob in the existing `assets` bucket (see settings/actions.ts) so we add no new
 * schema. Best-effort: returns "" when absent or unreadable.
 */
export async function loadBrandDna(): Promise<string> {
  try {
    const { data, error } = await supabase.storage
      .from("assets")
      .download("settings/brand_dna.json");
    if (error || !data) return "";
    const json = JSON.parse(await data.text());
    return typeof json.brand_dna === "string" ? json.brand_dna : "";
  } catch {
    return "";
  }
}

/**
 * The default SUBJECT reference image (the presenter, "Kruptoey"). Used to keep
 * the same face across every generated scene. Prefers an asset uploaded under the
 * `kruptoey/` prefix, then falls back to the most recent asset.
 */
export async function getDefaultSubjectRef(): Promise<string | null> {
  const { data } = await supabase
    .from("assets")
    .select("public_url, storage_path")
    .order("created_at", { ascending: false });
  if (!data || data.length === 0) return null;
  const kruptoey = data.find((a) => a.storage_path?.startsWith("kruptoey/"));
  return kruptoey?.public_url ?? data[0].public_url ?? null;
}
