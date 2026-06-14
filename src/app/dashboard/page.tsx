"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPersonasAction } from "./settings/actions";

export default function DashboardPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [personas, setPersonas] = useState<any[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [qualityMode, setQualityMode] = useState("Standard");
  const [directorsNote, setDirectorsNote] = useState("");
  const router = useRouter();

  useEffect(() => {
    const fetchPersonas = async () => {
      const res = await fetchPersonasAction();
      if (res.success && res.data && res.data.length > 0) {
        // Filter out system personas so they don't clutter the main selector
        const userPersonas = res.data.filter((p: any) => !p.name.startsWith("System -") && !p.name.startsWith("[DELETED] "));
        if (userPersonas.length > 0) {
          setPersonas(userPersonas);
          setSelectedPersonaId(userPersonas[0].id); // Select first by default
        }
      }
    };
    fetchPersonas();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    
    setLoading(true);
    
    try {
      const res = await fetch("/api/process-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: url, personaId: selectedPersonaId, qualityMode, directorsNote }),
      });
      
      if (!res.ok) throw new Error("Failed to start processing");
      
      const data = await res.json();
      
      if (data.videoId) {
         router.push(`/dashboard/preview/${data.videoId}`);
      } else {
         router.push("/dashboard/history");
      }
    } catch (error) {
      console.error(error);
      alert("Error starting the process. Check the console.");
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <Card>
        <CardHeader>
          <CardTitle>Create AI Automation</CardTitle>
          <CardDescription>
            Paste a YouTube URL below to let our 6-Agent Virtual Agency generate the absolute perfect metadata.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="youtube-url">YouTube URL</Label>
              <Input
                id="youtube-url"
                placeholder="https://youtu.be/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <p className="text-sm text-gray-500">
                The video must have clear audio for the AI to extract context.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="persona-select">Creative Director (Your Persona)</Label>
                {personas.length === 0 ? (
                  <p className="text-sm text-orange-500">No personas found. Default AI will be used.</p>
                ) : (
                  <select 
                    id="persona-select"
                    className="w-full border rounded-md p-2 text-sm bg-white"
                    value={selectedPersonaId}
                    onChange={(e) => setSelectedPersonaId(e.target.value)}
                  >
                    {personas.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="quality-select">Quality Mode (Agentic Loops)</Label>
                <select 
                  id="quality-select"
                  className="w-full border rounded-md p-2 text-sm bg-white"
                  value={qualityMode}
                  onChange={(e) => setQualityMode(e.target.value)}
                >
                  <option value="Standard">Standard (1 Loop - Faster & Cheaper)</option>
                  <option value="Maximize">Maximize (Up to 3 Loops - Highest Quality)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="directors-note" className="flex items-center text-indigo-700">
                <span className="font-bold">Director's Note</span>
                <span className="ml-2 text-xs font-normal text-gray-500">(Optional Runtime Briefing)</span>
              </Label>
              <textarea 
                id="directors-note"
                className="w-full min-h-[80px] p-2 border border-indigo-200 bg-indigo-50/30 rounded-md text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. 'Make sure the title mentions Elon Musk', 'Focus heavily on the urgency of AI', 'Do not use clickbait words like SHOCKING'"
                value={directorsNote}
                onChange={(e) => setDirectorsNote(e.target.value)}
              />
              <p className="text-xs text-gray-500 leading-tight">
                This note will be injected directly into the minds of the Analyst, SEO, Visuals, and Copywriter agents to dynamically steer their strategy for this specific video.
              </p>
            </div>

          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={loading || !url} className="w-full sm:w-auto">
              {loading ? "Initializing..." : "Start Processing"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
