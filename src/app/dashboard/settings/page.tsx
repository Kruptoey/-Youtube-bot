"use client";

import { useState, useEffect, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Upload, Trash2, ShieldCheck, AlertTriangle, Plus } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alertMsg, setAlertMsg] = useState<{type: "error" | "success", text: string} | null>(null);
  
  // Personas State
  const [personas, setPersonas] = useState<any[]>([]);
  const [newPersona, setNewPersona] = useState({ name: "", provider: "openai", model: "gpt-4o", system_prompt: "" });
  const [savingPersona, setSavingPersona] = useState(false);
  
  const [assets, setAssets] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  
  const [debugInfo, setDebugInfo] = useState<any>(null);

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    
    if (success) {
      setAlertMsg({ type: "success", text: "Successfully connected to YouTube!" });
      router.replace("/dashboard/settings");
    } else if (error) {
      setAlertMsg({ type: "error", text: "OAuth Error occurred." });
      router.replace("/dashboard/settings");
    }

    fetchSettings();
    fetchAssets();
    fetchPersonas();
  }, [searchParams, router]);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings/status", { cache: "no-store" });
      const json = await res.json();
      
      setDebugInfo({ apiResponse: json });
      
      if (json.isConnected) {
        setIsConnected(true);
      }
    } catch (error: any) {
      console.error("fetchSettings API error:", error);
      setDebugInfo({ error: error.message });
    }
  };

  const fetchPersonas = async () => {
    const { data } = await supabase.from("ai_personas").select("*").order("created_at", { ascending: true });
    if (data) setPersonas(data);
  };

  const fetchAssets = async () => {
    const { data } = await supabase.from("assets").select("*").order("created_at", { ascending: false });
    if (data) setAssets(data);
  };

  const handleConnect = () => {
    setLoading(true);
    window.location.href = "/api/auth/google";
  };

  const savePersona = async () => {
    if (!newPersona.name || !newPersona.system_prompt) return;
    setSavingPersona(true);
    
    const { error } = await supabase.from("ai_personas").insert([newPersona]);
    
    if (error) {
      setAlertMsg({ type: "error", text: error.message });
    } else {
      setAlertMsg({ type: "success", text: "Persona created successfully!" });
      setNewPersona({ name: "", provider: "openai", model: "gpt-4o", system_prompt: "" });
      fetchPersonas();
    }
    setTimeout(() => setAlertMsg(null), 3000);
    setSavingPersona(false);
  };

  const deletePersona = async (id: string) => {
    await supabase.from("ai_personas").delete().eq("id", id);
    fetchPersonas();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = `kruptoey/${fileName}`;

    const { error: uploadError } = await supabase.storage.from("assets").upload(filePath, file);
    if (!uploadError) {
      const { data: publicUrlData } = supabase.storage.from("assets").getPublicUrl(filePath);
      await supabase.from("assets").insert([{ filename: file.name, storage_path: filePath, public_url: publicUrlData.publicUrl }]);
      fetchAssets();
    }
    setUploading(false);
  };

  const deleteAsset = async (id: string, storagePath: string) => {
    await supabase.storage.from("assets").remove([storagePath]);
    await supabase.from("assets").delete().eq("id", id);
    fetchAssets();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <h2 className="text-2xl font-bold tracking-tight">System Settings</h2>
      
      {alertMsg && (
        <div className={`p-4 rounded-lg flex items-center ${alertMsg.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
          {alertMsg.type === "success" ? <ShieldCheck className="w-5 h-5 mr-2" /> : <AlertTriangle className="w-5 h-5 mr-2" />}
          {alertMsg.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>YouTube Channel Connection</CardTitle>
              <CardDescription>Connect EazyCal to enable auto-updates.</CardDescription>
            </CardHeader>
            <CardContent>
              {isConnected ? (
                <div className="flex items-center p-4 text-green-700 bg-green-50 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 mr-3" />
                  <div>
                    <p className="font-medium">Connected to YouTube</p>
                    <p className="text-sm text-green-600">Secure OAuth Token Active</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col p-4 text-amber-700 bg-amber-50 rounded-lg">
                  <div className="flex items-center">
                    <AlertCircle className="w-5 h-5 mr-3" />
                    <div>
                      <p className="font-medium">Not Connected</p>
                    </div>
                  </div>
                </div>
              )}
              {/* DEBUG INFO */}
              <div className="mt-4 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-48">
                <p className="font-bold text-red-500 mb-2">Debug Data (Please screenshot this box):</p>
                <pre>{JSON.stringify({ isConnected, debugInfo }, null, 2)}</pre>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleConnect} disabled={loading || isConnected} variant={isConnected ? "outline" : "default"}>
                {loading ? "Redirecting..." : isConnected ? "Reconnect YouTube" : "Connect with Google"}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assets (Kruptoey Images)</CardTitle>
              <CardDescription>Upload PNG images without background.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 mb-2 text-gray-500" />
                    <p className="text-sm text-gray-500">Click to upload or drag and drop</p>
                  </div>
                  <input type="file" className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleFileUpload} disabled={uploading} />
                </label>
              </div>
              {uploading && <p className="text-sm text-center text-blue-500">Uploading...</p>}
              
              <div className="grid grid-cols-3 gap-4 mt-4">
                {assets.map((asset) => (
                  <div key={asset.id} className="relative group rounded-md border overflow-hidden bg-gray-100 aspect-square flex items-center justify-center">
                    <img src={asset.public_url} alt="asset" className="object-contain w-full h-full" />
                    <button 
                      onClick={() => deleteAsset(asset.id, asset.storage_path)}
                      className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Persona Manager</CardTitle>
              <CardDescription>Configure different AI profiles and prompts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              <div className="space-y-4 border p-4 rounded-lg bg-gray-50">
                <h4 className="font-semibold text-sm">Create New Persona</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Persona Name</Label>
                    <Input placeholder="e.g. Clickbait Expert" value={newPersona.name} onChange={e => setNewPersona({...newPersona, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Provider</Label>
                    <select 
                      className="w-full border rounded-md p-2 text-sm"
                      value={newPersona.provider} 
                      onChange={e => setNewPersona({...newPersona, provider: e.target.value, model: e.target.value === 'openai' ? 'gpt-4o' : e.target.value === 'anthropic' ? 'claude-3-5-sonnet-20240620' : 'gemini-1.5-pro'})}
                    >
                      <option value="openai">OpenAI (ChatGPT)</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                      <option value="google">Google (Gemini)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Model</Label>
                  <Input value={newPersona.model} onChange={e => setNewPersona({...newPersona, model: e.target.value})} />
                </div>

                <div className="space-y-2">
                  <Label>System Prompt</Label>
                  <textarea 
                    className="w-full min-h-[100px] p-2 border rounded-md text-sm"
                    placeholder="You are an expert..."
                    value={newPersona.system_prompt}
                    onChange={e => setNewPersona({...newPersona, system_prompt: e.target.value})}
                  />
                </div>
                
                <Button onClick={savePersona} disabled={savingPersona || !newPersona.name} className="w-full">
                  <Plus className="w-4 h-4 mr-2" /> Add Persona
                </Button>
              </div>

              <div className="space-y-4">
                <h4 className="font-semibold text-sm">Existing Personas</h4>
                {personas.map(p => (
                  <div key={p.id} className="p-3 border rounded-md relative group bg-white shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <h5 className="font-bold text-sm">{p.name}</h5>
                        <p className="text-xs text-gray-500 uppercase tracking-wider">{p.provider} • {p.model}</p>
                      </div>
                      <button onClick={() => deletePersona(p.id)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-600 mt-2 line-clamp-2">{p.system_prompt}</p>
                  </div>
                ))}
              </div>

            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}
