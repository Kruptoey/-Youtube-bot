import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: videoId } = await params;

  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  try {
    // Fire and forget: Let Inngest handle the heavy lifting asynchronously
    await inngest.send({
      name: "video/approve.requested",
      data: {
        videoId: videoId
      }
    });

    return NextResponse.json({ success: true, message: "Upload queued to background worker." });
  } catch (error: any) {
    console.error("Error triggering approve:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
