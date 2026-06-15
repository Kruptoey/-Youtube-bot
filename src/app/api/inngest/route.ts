import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { processVideoFunction } from "@/inngest/functions";
import { updateYoutubeVideo } from "@/inngest/updateYoutube";
import { regenerateThumbnail } from "@/inngest/regenerateThumbnail";

// Create an API that serves zero-downtime background jobs
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processVideoFunction,
    updateYoutubeVideo,
    regenerateThumbnail,
  ],
});
