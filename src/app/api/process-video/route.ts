import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const unauthorized = await requireUser(req);
  if (unauthorized) return unauthorized;

  try {
    const { youtubeUrl, personaId, qualityMode, directorsNote, thumbnailRefUrl } = await req.json();

    if (!youtubeUrl) {
      return NextResponse.json({ error: "YouTube URL is required" }, { status: 400 });
    }

    // Basic extraction of video ID
    let videoId = "unknown";
    try {
      const urlObj = new URL(youtubeUrl);
      if (youtubeUrl.includes("youtu.be")) {
        videoId = urlObj.pathname.slice(1);
      } else {
        videoId = urlObj.searchParams.get("v") || "unknown";
      }
    } catch (e) {
      // Ignore URL parsing errors, use fallback
    }

    // Create a draft record in Supabase
    const { data, error } = await supabase
      .from("videos")
      .insert([
        {
          youtube_url: youtubeUrl,
          video_id: videoId,
          persona_id: personaId || null,
          status: "DRAFT"
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const dbRecordId = data.id;

    // Persist the optional reference image so a later "Regenerate" remembers it.
    // Best-effort: the column only exists after the thumbnail migration is applied,
    // so a failure here must NOT block starting the job (the worker also gets the ref
    // via the event payload below).
    if (thumbnailRefUrl) {
      const { error: refError } = await supabase
        .from("videos")
        .update({ thumbnail_ref_url: thumbnailRefUrl })
        .eq("id", dbRecordId);
      if (refError) {
        console.warn("[process-video] could not persist thumbnail_ref_url (run the thumbnail migration?):", refError.message);
      }
    }

    // Trigger Inngest Background Job
    await inngest.send({
      name: "video/process.requested",
      data: {
        videoId: dbRecordId,
        youtubeUrl: youtubeUrl,
        personaId: personaId,
        qualityMode: qualityMode || "Standard",
        directorsNote: directorsNote || "",
        thumbnailRefUrl: thumbnailRefUrl || ""
      }
    });

    return NextResponse.json({ success: true, videoId: dbRecordId });
  } catch (error: any) {
    console.error("Process API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
