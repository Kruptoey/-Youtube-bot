"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Check, RefreshCw, UploadCloud, AlertTriangle } from "lucide-react";

// Fetch video status via the server-side API route instead of querying Supabase
// directly from the browser. The direct browser query relies on a valid user JWT
// in cookies; if the cookie is absent or stale, RLS silently returns 0 rows and
// the page shows "LOADING" forever. The API route uses supabaseAdmin (service role)
// so it always sees the record regardless of the browser's auth state.
async function fetchVideoStatus(id: string): Promise<{ data: any | null; error: string | null }> {
  try {
    const res = await fetch(`/api/videos/${id}/status`);
    if (res.status === 404) return { data: null, error: null };
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error ?? "Server error" };
    return { data: json, error: null };
  } catch {
    return { data: null, error: "Network error" };
  }
}

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [video, setVideo] = useState<any>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  // useRef so both useEffect and handleApprove can start/stop the same interval
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearPoll = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchVideo = useCallback(async () => {
    const { data, error } = await fetchVideoStatus(id);

    if (error) {
      console.error("[preview] poll error:", error);
      setPollError(error);
      return;
    }

    setPollError(null);
    if (data) {
      setVideo(data);
      // Stop the processing poll at stable states:
      // - PENDING_APPROVAL: AI is done, user is reviewing — stop to prevent overwriting edits
      // - COMPLETED / FAILED: pipeline finished — no more polling needed
      // NOTE: UPLOADING_TO_YOUTUBE is intentionally excluded — polling must continue
      //       to detect when upload finishes and status becomes COMPLETED.
      if (["COMPLETED", "FAILED", "PENDING_APPROVAL"].includes(data.status)) {
        clearPoll();
        setRegenerating(false);
      }
    }
  }, [id, clearPoll]);

  useEffect(() => {
    fetchVideo();
    intervalRef.current = setInterval(fetchVideo, 3000);
    return clearPoll; // cleanup on unmount or id change
  }, [id, fetchVideo, clearPoll]);

  const handleApprove = async () => {
    if (!video) return;
    setLoading(true);

    try {
      // Send the inline edits in the request body. The route persists them with the
      // service-role client (off the RLS-gated browser client) BEFORE queueing the
      // upload, so a stale auth cookie can no longer cause the old draft to be uploaded.
      const res = await fetch(`/api/videos/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generated_title: video.generated_title,
          generated_description: video.generated_description,
          generated_tags: video.generated_tags,
        }),
      });

      if (res.ok) {
        // Restart polling so the UI detects UPLOADING_TO_YOUTUBE → COMPLETED transition.
        // fetchVideo is stable (useCallback) and accessible here because of the useRef pattern.
        intervalRef.current = setInterval(fetchVideo, 3000);
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert("Error queuing update: " + (errorData.error ?? res.statusText));
        setLoading(false);
      }
    } catch {
      alert("Network error");
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!video || regenerating) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/videos/${id}/regenerate-thumbnail`, { method: "POST" });
      if (res.ok) {
        // The worker flips status to GENERATING_THUMBNAIL → PENDING_APPROVAL; poll to
        // pick up the freshly composited thumbnail.
        intervalRef.current = setInterval(fetchVideo, 3000);
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert("Error queuing regeneration: " + (errorData.error ?? res.statusText));
        setRegenerating(false);
      }
    } catch {
      alert("Network error");
      setRegenerating(false);
    }
  };

  // ── Processing (DRAFT / EXTRACTING_AUDIO / AI_ANALYZING) ────────────────────────
  // NOTE: GENERATING_THUMBNAIL is intentionally NOT here — once the text is ready we
  // show the editable review UI immediately (perceived speed) and let the thumbnail
  // fill in. Polling continues until PENDING_APPROVAL.
  if (!video || ["DRAFT", "EXTRACTING_AUDIO", "AI_ANALYZING"].includes(video.status)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <RefreshCw className="w-12 h-12 animate-spin text-primary" />
        <h2 className="text-2xl font-bold">AI is analyzing the video...</h2>
        <p className="text-gray-500">This might take a minute or two depending on the video length.</p>
        <p className="text-sm font-mono text-gray-400">Current State: {video?.status ?? "LOADING"}</p>
        {pollError && (
          <div className="text-xs text-red-500 font-mono bg-red-50 border border-red-200 p-3 rounded max-w-md break-all text-left">
            <strong>DB Error (check .env.local + Supabase RLS):</strong>
            <br />
            {pollError}
          </div>
        )}
      </div>
    );
  }

  // ── Uploading ─────────────────────────────────────────────────────────────────
  if (video.status === "UPLOADING_TO_YOUTUBE") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <UploadCloud className="w-12 h-12 animate-pulse text-blue-600" />
        <h2 className="text-2xl font-bold">Uploading to YouTube...</h2>
        <p className="text-gray-500">Inngest is updating the metadata and uploading the thumbnail.</p>
      </div>
    );
  }

  // ── Complete ──────────────────────────────────────────────────────────────────
  if (video.status === "COMPLETED") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Check className="w-16 h-16 text-green-500" />
        <h2 className="text-3xl font-bold text-green-700">Automation Complete!</h2>
        <p className="text-gray-600 text-lg">Your video has been successfully updated on YouTube.</p>
        <Button onClick={() => router.push("/dashboard")}>Process Another Video</Button>
      </div>
    );
  }

  // ── Failed ────────────────────────────────────────────────────────────────────
  if (video.status === "FAILED") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center px-4">
        <AlertTriangle className="w-16 h-16 text-red-500" />
        <h2 className="text-3xl font-bold text-red-700">Automation Failed</h2>
        <p className="text-gray-600 max-w-xl">
          {video.error_message || "Something went wrong while processing this video."}
        </p>
        <Button onClick={() => router.push("/dashboard")}>Try Another Video</Button>
      </div>
    );
  }

  // ── PENDING_APPROVAL / GENERATING_THUMBNAIL (review UI) ─────────────────────────
  // Text is shown immediately; while the thumbnail is still rendering we keep the
  // review editable but gate Approve so only the finished thumbnail gets uploaded.
  const isGeneratingThumb = video.status === "GENERATING_THUMBNAIL";
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Review & Approve</h2>
        <Button
          onClick={handleApprove}
          disabled={loading || isGeneratingThumb}
          className="bg-green-600 hover:bg-green-700"
        >
          {loading ? (
            "Approving..."
          ) : isGeneratingThumb ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Finishing thumbnail...
            </>
          ) : (
            <>
              <Check className="w-4 h-4 mr-2" />
              Approve & Update
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Generated Thumbnail Preview</CardTitle>
              <CardDescription>
                AI scene + deterministic Thai text.{" "}
                {video.thumbnail_qc?.pass === false && (
                  <span className="text-amber-600">QC flagged issues — try Regenerate.</span>
                )}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={regenerating || isGeneratingThumb}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${regenerating || isGeneratingThumb ? "animate-spin" : ""}`} />
              {regenerating ? "Regenerating..." : "Regenerate"}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-gray-200 shadow-sm bg-gray-100">
              {isGeneratingThumb ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500">
                  <RefreshCw className="w-10 h-10 animate-spin text-primary" />
                  <p className="text-sm font-medium">Designing your thumbnail…</p>
                  <p className="text-xs">Art Director is composing the scene; QC checks it before you see it.</p>
                </div>
              ) : (
                <img
                  src={video.generated_thumbnail_url || `/api/og?videoId=${video.id}`}
                  alt="Thumbnail Preview"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "https://placehold.co/1280x720/e2e8f0/64748b?text=Preview+Loading...";
                  }}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SEO Title</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full min-h-[80px] p-3 border rounded-md"
              value={video.generated_title || ""}
              onChange={(e) => setVideo({ ...video, generated_title: e.target.value })}
            />
            <p
              className={`text-xs mt-2 text-right ${
                video.generated_title?.length > 100 ? "text-red-500" : "text-gray-500"
              }`}
            >
              {video.generated_title?.length || 0} / 100 chars
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={
                Array.isArray(video.generated_tags)
                  ? video.generated_tags.join(", ")
                  : video.generated_tags || ""
              }
              onChange={(e) => setVideo({ ...video, generated_tags: e.target.value })}
            />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full min-h-[300px] p-3 border rounded-md font-mono text-sm"
              value={video.generated_description || ""}
              onChange={(e) => setVideo({ ...video, generated_description: e.target.value })}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
