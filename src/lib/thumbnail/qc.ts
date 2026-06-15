import { generateObject } from "ai";
import { z } from "zod";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ThumbnailBrief } from "./brief";

/**
 * QC vision verdict on the FINAL composited thumbnail. This is the mechanism that
 * makes "no editing needed" a system guarantee rather than a hope: a bad render is
 * caught and regenerated automatically before the user ever sees it.
 */
export const QcResultSchema = z.object({
  pass: z.boolean().describe("Overall: is this thumbnail ready to publish as-is?"),
  legible: z.boolean().describe("Is every text layer fully readable and not clipped or overlapping the face?"),
  face_ok: z.boolean().describe("Does the presenter look natural (no distortion, extra limbs, melted face)?"),
  balanced: z.boolean().describe("Is the composition balanced and nothing important cropped at the edges?"),
  issues: z
    .array(z.string())
    .describe(
      "Short, actionable fixes if anything failed (these are fed back into the next " +
        "image prompt). Empty when pass=true."
    ),
});

export type QcResult = z.infer<typeof QcResultSchema>;

/**
 * Judge a composited thumbnail. The image bytes are passed INLINE (not as a URL)
 * so the model never has to reach a localhost/preview URL.
 */
export async function qcThumbnail(
  pngBytes: Uint8Array,
  brief: ThumbnailBrief
): Promise<QcResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for thumbnail QC.");
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_QC_MODEL || "gemini-2.5-flash";

  const expectedText = brief.text_layers.map((l) => l.th).join(" / ");

  const { object } = await generateObject({
    model: google(model),
    schema: QcResultSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "You are a ruthless senior YouTube thumbnail art director doing final QC. " +
              "Judge ONLY the attached image.\n" +
              `Expected Thai text on the image: "${expectedText}".\n` +
              "FAIL (pass=false) if: any text is unreadable, clipped, or overlaps the face; " +
              "the person looks distorted/unnatural; the composition is unbalanced or important " +
              "elements are cropped; or it looks low-quality/amateur.\n" +
              "If you fail it, give short, concrete fixes in `issues` (e.g. 'move subject further " +
              "right', 'reduce background clutter behind text', 'fix distorted hand'). " +
              "Keep `issues` empty when it passes.",
          },
          { type: "image", image: pngBytes, mediaType: "image/png" },
        ],
      },
    ],
  });

  return object;
}
