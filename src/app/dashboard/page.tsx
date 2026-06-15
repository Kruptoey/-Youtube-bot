"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPersonasAction, uploadReferenceAction } from "./settings/actions";

export default function DashboardPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [personas, setPersonas] = useState<any[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [qualityMode, setQualityMode] = useState("Standard");
  const defaultDirectorsNote = `วิดีโอนี้เป็นคลิปติวสอบระดับมหาวิทยาลัยของช่อง Eazy Cal (Academic/Tutoring) โทนต้องมืออาชีพ น่าเชื่อถือ แต่มีพลังและกระตุ้นให้คลิก

📝 ข้อความ (Title / Description):
1. Title: โครงสร้างชัด ค้นหาง่าย = [ชื่อวิชา] + [หัวข้อที่สอน] + [จุดประสงค์ เช่น เฉลย Mock/ติวไฟนอล] — ไม่หลอกลวง แต่ชูความ "ออกสอบจริง" ได้
2. Description: สรุปเนื้อหาอย่างเป็นระบบ ระบุชัดว่าเหมาะกับใคร (เช่น นศ. วิศวะ/วิทยาศาสตร์) และสิ่งที่จะได้เรียนรู้จากคลิป
3. Thumbnail text หลัก: ดึง Keyword บทเรียนมาแค่ 1-3 คำ อ่านง่ายที่สุด เช่น 'หา Curl', 'Triple Integral', 'Calculus 1'

🎨 Thumbnail visual direction (ปรับให้เข้ากับคลิปนี้):
- ครู: สีหน้า expressive ให้เข้ากับเนื้อหา — ยิ้มกว้างชี้นิ้ว (มั่นใจ/สนุก) หรือทำหน้าตกใจ "อันนี้สำคัญ!" (จุดที่นักศึกษาพลาดบ่อย)
- พื้นหลัง: ใส่สมการ/ไดอะแกรม "ของหัวข้อคลิปนี้จริง ๆ" แบบเรืองแสง (เช่น integral, curl, 3D coordinates) เลือกพื้นสว่างพลังงานสูง หรือมืดดราม่านีออนก็ได้ตามอารมณ์เนื้อหา
- ตัวอักษร: headline หัวข้อชัด + เพิ่มบรรทัดล่างสีแดง/ส้มเป็น hook กระตุ้นการสอบ เช่น "ออกสอบจริง!", "โคตรออกสอบ", "เข้าใจใน 10 นาที"`;

  const [directorsNote, setDirectorsNote] = useState(defaultDirectorsNote);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [thumbnailRefUrl, setThumbnailRefUrl] = useState("");
  const [uploadingRef, setUploadingRef] = useState(false);
  const router = useRouter();

  const handleRefUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadingRef(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadReferenceAction(fd);
      if (res.success && res.url) {
        setThumbnailRefUrl(res.url);
      } else {
        alert("Upload failed: " + (res.error ?? "unknown error"));
      }
    } finally {
      setUploadingRef(false);
    }
  };

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
        body: JSON.stringify({ youtubeUrl: url, personaId: selectedPersonaId, qualityMode, directorsNote, thumbnailRefUrl }),
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

            {/* Advanced: optional thumbnail reference image (progressive disclosure —
                the default pipeline needs no input; power users can steer the look). */}
            <div className="border-t pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                {showAdvanced ? "▾" : "▸"} Advanced — custom thumbnail look (optional)
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-2">
                  <Label htmlFor="thumb-ref">Reference image (style or subject)</Label>
                  <input
                    id="thumb-ref"
                    type="file"
                    accept="image/*"
                    disabled={uploadingRef}
                    onChange={(e) => handleRefUpload(e.target.files?.[0])}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-indigo-700"
                  />
                  <p className="text-xs text-gray-500 leading-tight">
                    Optional. Upload a thumbnail style you like, or a specific photo of the
                    presenter. The image model uses it as a reference. Leave empty to use the
                    channel default.
                  </p>
                  {uploadingRef && <p className="text-xs text-indigo-600">Uploading…</p>}
                  {thumbnailRefUrl && !uploadingRef && (
                    <div className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbnailRefUrl} alt="reference" className="h-16 w-auto rounded border" />
                      <button
                        type="button"
                        onClick={() => setThumbnailRefUrl("")}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
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
