"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Check, RefreshCw, UploadCloud, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  
  const [loading, setLoading] = useState(false);
  const [video, setVideo] = useState<any>(null);
  
  // Polling to fetch real video data
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    const fetchVideo = async () => {
      const { data } = await supabase.from("videos").select("*").eq("id", id).single();
      if (data) {
        setVideo(data);
        if (data.status === "COMPLETED" || data.status === "FAILED") {
          clearInterval(interval);
        }
      }
    };

    fetchVideo();
    interval = setInterval(fetchVideo, 3000);
    
    return () => clearInterval(interval);
  }, [id]);

  const handleApprove = async () => {
    if (!video) return;
    setLoading(true);
    
    // Save any manual edits to DB first
    await supabase.from("videos").update({
      generated_title: video.generated_title,
      generated_description: video.generated_description,
      generated_tags: Array.isArray(video.generated_tags) ? video.generated_tags : video.generated_tags?.split(',').map((t: string) => t.trim())
    }).eq("id", id);

    try {
      // Trigger Inngest background upload
      const res = await fetch(`/api/videos/${id}/approve`, {
        method: "POST"
      });
      
      if (res.ok) {
        // UI will update automatically on next poll since status will change to UPLOADING_TO_YOUTUBE
      } else {
        const errorData = await res.json();
        alert("Error queuing update: " + errorData.error);
        setLoading(false);
      }
    } catch (e) {
      alert("Network error");
      setLoading(false);
    }
  };

  if (!video || video.status === "DRAFT" || video.status === "EXTRACTING_AUDIO" || video.status === "AI_ANALYZING") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <RefreshCw className="w-12 h-12 animate-spin text-primary" />
        <h2 className="text-2xl font-bold">AI is analyzing the video...</h2>
        <p className="text-gray-500">This might take a minute or two depending on the video length.</p>
        <p className="text-sm font-mono text-gray-400">Current State: {video?.status || "LOADING"}</p>
      </div>
    );
  }

  if (video.status === "UPLOADING_TO_YOUTUBE") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <UploadCloud className="w-12 h-12 animate-pulse text-blue-600" />
        <h2 className="text-2xl font-bold">Uploading to YouTube...</h2>
        <p className="text-gray-500">Inngest is updating the metadata and uploading the thumbnail.</p>
      </div>
    );
  }

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

  // PENDING_APPROVAL State
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Review & Approve</h2>
        <div className="space-x-2">
          <Button onClick={handleApprove} disabled={loading} className="bg-green-600 hover:bg-green-700">
            {loading ? "Approving..." : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Approve & Update
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Generated Thumbnail Preview</CardTitle>
            <CardDescription>Generated via Edge Satori (HTML to Image)</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Fetch real OG image from our API */}
            <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-gray-200 shadow-sm">
               <img 
                 src={`/api/og?videoId=${video.id}`} 
                 alt="Thumbnail Preview" 
                 className="w-full h-full object-cover"
                 onError={(e) => {
                   (e.target as HTMLImageElement).src = "https://placehold.co/1280x720/e2e8f0/64748b?text=Preview+Loading...";
                 }}
               />
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
            <p className={`text-xs mt-2 text-right ${video.generated_title?.length > 100 ? 'text-red-500' : 'text-gray-500'}`}>
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
              value={Array.isArray(video.generated_tags) ? video.generated_tags.join(", ") : video.generated_tags || ""}
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
