import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireUser } from "@/lib/api-auth";

type ApproveBody = {
  generated_title?: string;
  generated_description?: string;
  generated_tags?: string | string[];
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const { id: videoId } = await params;
  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  // Persist the user's inline edits server-side via the service-role client BEFORE
  // queueing the upload. The worker reads this metadata back from the DB, so saving
  // here (instead of from the browser) keeps the write off the RLS-gated anon client
  // — the same stale-JWT failure that broke the read path would otherwise silently
  // upload the old AI draft instead of the user's edits.
  let body: ApproveBody = {};
  try {
    body = (await request.json()) as ApproveBody;
  } catch {
    // No body / invalid JSON: nothing to persist, fall through to queue as-is.
  }

  const update: Record<string, unknown> = {};
  if (typeof body.generated_title === "string") update.generated_title = body.generated_title;
  if (typeof body.generated_description === "string")
    update.generated_description = body.generated_description;
  if (body.generated_tags !== undefined) {
    // Normalize to the string[] the YouTube API and DB column expect.
    update.generated_tags = Array.isArray(body.generated_tags)
      ? body.generated_tags
      : String(body.generated_tags)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
  }

  if (Object.keys(update).length > 0) {
    const { error: saveError } = await supabaseAdmin
      .from("videos")
      .update(update)
      .eq("id", videoId);
    if (saveError) {
      console.error("Error saving edits before approve:", saveError);
      return NextResponse.json(
        { error: "Failed to save your edits: " + saveError.message },
        { status: 500 }
      );
    }
  }

  try {
    // Fire and forget: Inngest handles the upload asynchronously.
    await inngest.send({
      name: "video/approve.requested",
      data: { videoId },
    });

    return NextResponse.json({ success: true, message: "Upload queued to background worker." });
  } catch (error) {
    console.error("Error triggering approve:", error);
    const message = error instanceof Error ? error.message : "Failed to queue upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
