"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [personas, setPersonas] = useState<any[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const router = useRouter();

  useEffect(() => {
    const fetchPersonas = async () => {
      const { data } = await supabase.from("ai_personas").select("*").order("created_at", { ascending: true });
      if (data && data.length > 0) {
        setPersonas(data);
        setSelectedPersonaId(data[0].id); // Select first by default
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
        body: JSON.stringify({ youtubeUrl: url, personaId: selectedPersonaId }),
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
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Create AI Automation</CardTitle>
          <CardDescription>
            Paste a YouTube URL below to let AI generate a new Title, Description, Tags, and Thumbnail.
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

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="persona-select">Select AI Persona</Label>
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
                      {p.name} ({p.provider.toUpperCase()} - {p.model})
                    </option>
                  ))}
                </select>
              )}
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
