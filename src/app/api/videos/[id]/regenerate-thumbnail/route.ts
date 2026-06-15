import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { requireUser } from "@/lib/api-auth";

/**
 * Queue a manual thumbnail regeneration. Like /approve, this bypasses RLS via the
 * background worker, so it gates on a valid session first.
 */
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

  // Optional extra steering note for this regeneration only.
  let directorsNote = "";
  try {
    const body = await request.json();
    if (typeof body?.directorsNote === "string") directorsNote = body.directorsNote;
  } catch {
    /* no body — regenerate with existing brief inputs */
  }

  try {
    await inngest.send({
      name: "video/thumbnail.regenerate",
      data: { videoId, directorsNote },
    });
    return NextResponse.json({ success: true, message: "Thumbnail regeneration queued." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue regeneration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
