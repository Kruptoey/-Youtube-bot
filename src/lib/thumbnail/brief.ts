import { generateObject } from "ai";
import { z } from "zod";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { BRAND_KIT } from "./brand";
import type { AiCost } from "@/lib/ai-cost";

/**
 * The Art Director's structured brief. The DYNAMIC half of the design — it varies
 * per video and drives both the image model (scene/pose) and the compositor
 * (text_layers). See docs/thumbnail-ai-design.md §5.
 */
export const ThumbnailBriefSchema = z.object({
  // TOPIC-specific kebab tag for Background Library reuse. Because backgrounds show
  // the lesson's actual equations, the tag must identify the TOPIC (not a generic
  // archetype) so reuse only happens for genuinely same-topic videos.
  scene_tag: z
    .string()
    .describe(
      "A TOPIC-specific kebab-case tag so a background is only reused for the SAME " +
        "lesson topic (its equations must match). e.g. 'calculus1-implicit-diff', " +
        "'calculus2-curl', 'calculus-triple-integral'. Do NOT use a broad tag like " +
        "'calculus' that would reuse the wrong equations."
    ),
  scene: z
    .string()
    .describe(
      "Detailed ENGLISH scene description for the image model: the backdrop, props, " +
        "equations/graphics, lighting. No text/letters."
    ),
  subject_pose: z
    .string()
    .describe("ENGLISH description of the presenter's pose, expression and framing."),
  layout: z
    .enum(["subject-left", "subject-right"])
    .describe("Which side the presenter occupies; text goes on the opposite side."),
  needs_custom_scene: z
    .boolean()
    .describe(
      "TRUE when this lesson topic needs its own background with its own equations " +
        "(the usual case for this channel — each topic shows different math). FALSE only " +
        "if the exact same topic was almost certainly produced before and its background " +
        "can be reused as-is."
    ),
  color_palette: z
    .array(z.string())
    .min(2)
    .max(5)
    .describe("Hex colours for the scene, anchored on the brand palette."),
  text_layers: z
    .array(
      z.object({
        th: z.string().describe("The Thai text for this layer. SHORT — 1-4 words."),
        role: z.enum(["headline", "accent", "sub"]),
        fill: z.string().describe("Hex fill colour."),
        stroke: z.string().describe("Hex outline colour for legibility."),
      })
    )
    .min(1)
    .max(3)
    .describe(
      "1-3 Thai text layers, ordered. A bold headline, an optional coloured accent " +
        "(the single most clickable phrase), and an optional smaller sub-line."
    ),
});

export type ThumbnailBrief = z.infer<typeof ThumbnailBriefSchema>;

export interface BriefInput {
  transcript: string;
  analyst: { core_value?: string; target_audience?: string; pain_points?: string[] };
  thumbnailText: string;
  title: string;
  directorsNote?: string;
  brandDna?: string;
  qualityMode?: string;
}

/**
 * The Art Director agent. Cheapest capable model (Gemini Flash) — the heavy
 * creative lifting (titles/copy) already happened upstream; here we only translate
 * the winning angle into a concrete visual brief, anchored on the static brand kit.
 */
export async function buildThumbnailBrief(input: BriefInput, cost?: AiCost): Promise<ThumbnailBrief> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for the thumbnail Art Director.");
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_BRIEF_MODEL || "gemini-2.5-flash";

  const directorNote = input.directorsNote
    ? `\n\nCRITICAL DIRECTOR'S NOTE (highest priority — obey it):\n"""\n${input.directorsNote}\n"""`
    : "";
  const brandDna = input.brandDna ? `\n\nChannel Brand DNA:\n${input.brandDna}` : "";

  const { object, usage } = await generateObject({
    model: google(model),
    schema: ThumbnailBriefSchema,
    prompt:
      `You are the ART DIRECTOR for the "${BRAND_KIT.name}" Thai education channel.\n` +
      `Brand style (must honour): ${BRAND_KIT.styleGuide}\n` +
      `Brand palette: ${BRAND_KIT.palette.join(", ")}.` +
      brandDna +
      directorNote +
      `\n\nDesign a thumbnail brief for this video.\n` +
      `Winning title: ${input.title}\n` +
      `Approved thumbnail text (use as the basis for text_layers, keep it SHORT and Thai): ${input.thumbnailText}\n` +
      `Core value: ${input.analyst.core_value ?? ""}\n` +
      `Target audience: ${input.analyst.target_audience ?? ""}\n\n` +
      `Rules:\n` +
      `- text_layers MUST be Thai, short (1-4 words each), and maximally legible.\n` +
      `- Anchor colours on the brand palette; a white or yellow headline with a black outline + a red/orange exam-urgency sub-line reads best.\n` +
      `- The background equations MUST match this lesson's topic. Use a TOPIC-specific scene_tag and set needs_custom_scene=true unless the exact topic was clearly produced before.`,
  });

  cost?.addTokens("thumbnail:brief", model, usage);
  return object;
}
