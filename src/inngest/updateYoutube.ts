import { inngest } from "./client";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { google } from "googleapis";

export const updateYoutubeVideo = inngest.createFunction(
  {
    id: "update-youtube-video",
    retries: 3,
    triggers: [{ event: "video/approve.requested" }],
    // Persist FAILED + the reason once retries are exhausted so an upload that
    // could not complete doesn't leave the video stuck on UPLOADING_TO_YOUTUBE.
    onFailure: async ({ event, error }) => {
      const videoId = event?.data?.event?.data?.videoId;
      if (!videoId) return;
      await supabase
        .from("videos")
        .update({
          status: "FAILED",
          error_message: String(error?.message ?? error).slice(0, 1000),
        })
        .eq("id", videoId);
    },
  },
  async ({ event, step }) => {
    const { videoId } = event.data;

    // Step 1: Update status to UPLOADING_TO_YOUTUBE
    await step.run("update-status", async () => {
      await supabase
        .from("videos")
        .update({ status: "UPLOADING_TO_YOUTUBE" })
        .eq("id", videoId);
    });

    // Step 2: Fetch Video Data & Auth Tokens
    const { video, auth } = await step.run("fetch-data", async () => {
      const { data: videoData } = await supabase.from("videos").select("*").eq("id", videoId).single();
      const { data: authData } = await supabase.from("channel_settings").select("*").limit(1).single();
      
      if (!authData || !authData.refresh_token) {
        throw new Error("No YouTube OAuth refresh_token found in channel_settings");
      }
      
      return { video: videoData, auth: authData };
    });

    // Step 3: Update YouTube Snippet (Title, Desc, Tags)
    await step.run("update-youtube-metadata", async () => {
      const oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET
      );
      oauth2Client.setCredentials({ refresh_token: auth.refresh_token });

      const youtube = google.youtube({ version: "v3", auth: oauth2Client });

      // YouTube API expects an array of strings for tags
      const tagsArray = video.generated_tags || [];

      // We need the categoryId of the video to update it without losing it, 
      // but for MVP we will just fetch the current video snippet first to preserve existing data.
      const currentVideoRes = await youtube.videos.list({
        part: ["snippet"],
        id: [video.video_id]
      });

      const currentSnippet = currentVideoRes.data.items?.[0]?.snippet;
      if (!currentSnippet) throw new Error("Video not found on YouTube");

      await youtube.videos.update({
        part: ["snippet"],
        requestBody: {
          id: video.video_id,
          snippet: {
            ...currentSnippet, // Preserve categoryId etc.
            title: video.generated_title.substring(0, 100), // Max 100 chars
            description: video.generated_description.substring(0, 5000), // Max 5000 chars
            tags: tagsArray
          }
        }
      });
    });

    // Step 4: Generate Thumbnail and Upload to YouTube
    await step.run("upload-youtube-thumbnail", async () => {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const ogUrl = `${baseUrl}/api/og?videoId=${videoId}`;
      
      // Fetch the generated image
      const imageRes = await fetch(ogUrl);
      if (!imageRes.ok) throw new Error("Failed to generate OG image for thumbnail");
      
      const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

      // Setup YouTube Auth
      const oauth2Client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET
      );
      oauth2Client.setCredentials({ refresh_token: auth.refresh_token });
      const youtube = google.youtube({ version: "v3", auth: oauth2Client });

      // Upload Thumbnail
      await youtube.thumbnails.set({
        videoId: video.video_id,
        media: {
          mimeType: "image/png", // /api/og returns PNG
          body: require("stream").Readable.from(imageBuffer)
        }
      });
    });

    // Step 5: Mark as COMPLETED
    await step.run("finalize", async () => {
      await supabase
        .from("videos")
        .update({ status: "COMPLETED" })
        .eq("id", videoId);
    });

    return { success: true, videoId };
  }
);
