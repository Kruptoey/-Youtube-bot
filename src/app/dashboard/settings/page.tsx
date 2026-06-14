"use client";

import { useState, useEffect, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Upload, Trash2, ShieldCheck, AlertTriangle } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alertMsg, setAlertMsg] = useState<{type: "error" | "success", text: string} | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [brandDNA, setBrandDNA] = useState("");
  const [savingDNA, setSavingDNA] = useState(false);

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
    fetchBrandDNA();
  }, [searchParams, router]);

  const fetchBrandDNA = async () => {
    const { fetchBrandDNAAction } = await import('./actions');
    const res = await fetchBrandDNAAction();
    if (res.success) {
      setBrandDNA(res.data);
    }
  };

  const saveBrandDNA = async () => {
    setSavingDNA(true);
    const { saveBrandDNAAction } = await import('./actions');
    const res = await saveBrandDNAAction(brandDNA);
    if (res.error) setAlertMsg({ type: "error", text: res.error });
    else setAlertMsg({ type: "success", text: "Brand DNA saved successfully!" });
    setTimeout(() => setAlertMsg(null), 3000);
    setSavingDNA(false);
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings/status", { cache: "no-store" });
      const json = await res.json();
      if (json.isConnected) setIsConnected(true);
    } catch (error: any) {
      console.error("fetchSettings API error:", error);
    }
  };

  const fetchAssets = async () => {
    try {
      const { fetchAssetsAction } = await import('./actions');
      const res = await fetchAssetsAction();
      if (res.success && res.data) {
        setAssets(res.data);
      } else {
        console.error("Failed to fetch assets:", res.error);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnect = () => {
    setLoading(true);
    window.location.href = "/api/auth/google";
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, folder: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const { uploadAssetAction } = await import('./actions');
      const res = await uploadAssetAction(formData, folder);
      
      if (res.error) {
        alert(res.error);
      } else {
        fetchAssets();
      }
    } catch (err: any) {
      console.error(err);
      alert("Unexpected error during upload.");
    }
    setUploading(false);
  };

  const deleteAsset = async (id: string, storagePath: string) => {
    const { deleteAssetAction } = await import('./actions');
    const res = await deleteAssetAction(id, storagePath);
    if (res.error) {
      alert(res.error);
    } else {
      fetchAssets();
    }
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Left Column */}
        <div className="space-y-6 flex flex-col">
          <Card className="flex-1">
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
            </CardContent>
            <CardFooter>
              <Button onClick={handleConnect} disabled={loading || isConnected} variant={isConnected ? "outline" : "default"}>
                {loading ? "Redirecting..." : isConnected ? "Reconnect YouTube" : "Connect with Google"}
              </Button>
            </CardFooter>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>1. Brand DNA (Optional)</CardTitle>
              <CardDescription>Define your brand's core rules (Colors, Fonts, Tone). AI will use this as a reference.</CardDescription>
            </CardHeader>
            <CardContent>
              <textarea 
                className="w-full h-32 p-3 text-sm border rounded-md" 
                placeholder="e.g., Primary Color: #FF0000, Font: Roboto, Tone: Fun and energetic..."
                value={brandDNA}
                onChange={(e) => setBrandDNA(e.target.value)}
              />
            </CardContent>
            <CardFooter>
              <Button onClick={saveBrandDNA} disabled={savingDNA}>
                {savingDNA ? "Saving..." : "Save Brand DNA"}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6 flex flex-col">
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>2. Brand Logos (Optional)</CardTitle>
              <CardDescription>Upload official institution logos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-6 h-6 mb-2 text-gray-500" />
                    <p className="text-sm text-gray-500">Upload Logo</p>
                  </div>
                  <input type="file" className="hidden" accept="image/png, image/jpeg, image/webp, image/svg+xml" onChange={(e) => handleFileUpload(e, 'logo')} disabled={uploading} />
                </label>
              </div>
              
              {assets.filter(a => a.storage_path.startsWith('logo/')).length === 0 ? (
                <div className="mt-2 p-4 border border-dashed rounded-lg flex flex-col items-center justify-center text-gray-500 bg-gray-50/50 text-xs text-center">
                  No logos uploaded. Video will be generated without a watermark.
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-4 mt-4">
                  {assets.filter(a => a.storage_path.startsWith('logo/')).map((asset) => (
                    <div key={asset.id} className="relative group rounded-md border overflow-hidden bg-gray-100 aspect-square flex items-center justify-center p-2">
                      <img src={asset.public_url} alt="logo" className="object-contain w-full h-full" />
                      <button 
                        onClick={() => deleteAsset(asset.id, asset.storage_path)}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>3. Mascots / Presenters (Optional)</CardTitle>
              <CardDescription>Upload character images without background.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-6 h-6 mb-2 text-gray-500" />
                    <p className="text-sm text-gray-500">Upload Mascot</p>
                  </div>
                  <input type="file" className="hidden" accept="image/png, image/jpeg, image/webp" onChange={(e) => handleFileUpload(e, 'kruptoey')} disabled={uploading} />
                </label>
              </div>
              
              {assets.filter(a => a.storage_path.startsWith('kruptoey/')).length === 0 ? (
                <div className="mt-2 p-4 border border-dashed rounded-lg flex flex-col items-center justify-center text-gray-500 bg-gray-50/50 text-xs text-center">
                  No mascots uploaded.
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-4 mt-4">
                  {assets.filter(a => a.storage_path.startsWith('kruptoey/')).map((asset) => (
                    <div key={asset.id} className="relative group rounded-md border overflow-hidden bg-gray-100 aspect-square flex items-center justify-center">
                      <img src={asset.public_url} alt="mascot" className="object-contain w-full h-full" />
                      <button 
                        onClick={() => deleteAsset(asset.id, asset.storage_path)}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
