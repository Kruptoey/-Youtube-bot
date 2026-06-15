import { inngest } from "./client";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { produceThumbnail } from "@/lib/thumbnail";

/**
 * Manual "Regenerate thumbnail" from the preview screen. Reruns the thumbnail
 * pipeline in place (Maximize mode → always a fresh, best-effort scene) without
 * touching the already-approved title/description/tags.
 */
export const regenerateThumbnail = inngest.createFunction(
  {
    id: "regenerate-thumbnail",
    retries: 1,
    triggers: [{ event: "video/thumbnail.regenerate" }],
    // Never leave the row stuck on GENERATING_THUMBNAIL if the worker dies.
    onFailure: async ({ event }) => {
      const videoId = event?.data?.event?.data?.videoId;
      if (videoId) {
        await supabase.from("videos").update({ status: "PENDING_APPROVAL" }).eq("id", videoId);
      }
    },
  },
  async ({ event, step }) => {
    const { videoId, directorsNote } = event.data;

    const video = await step.run("load-and-mark", async () => {
      const { data } = await supabase.from("videos").select("*").eq("id", videoId).single();
      if (!data) throw new Error(`Video record ${videoId} not found`);
      await supabase.from("videos").update({ status: "GENERATING_THUMBNAIL" }).eq("id", videoId);
      return data;
    });

    await step.run("regenerate", async () => {
      try {
        await produceThumbnail({
          videoId,
          transcript: video.transcript || "",
          analyst: {},
          thumbnailText: video.generated_thumbnail_text || video.generated_title || "",
          title: video.generated_title || "",
          directorsNote: directorsNote || "",
          qualityMode: "Maximize",
          refUrl: video.thumbnail_ref_url || null,
        });
      } catch (e) {
        console.error("[thumbnail] manual regenerate failed (non-fatal):", e);
      }
      return { ok: true };
    });

    await step.run("finalize", async () => {
      await supabase.from("videos").update({ status: "PENDING_APPROVAL" }).eq("id", videoId);
    });

    return { success: true, videoId };
  }
);
