"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Video, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

type HistoryItem = {
  id: string;
  youtube_url: string;
  status: string;
  generated_title: string | null;
  created_at: string;
};

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from("videos")
        .select("id, youtube_url, status, generated_title, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        setError(error.message);
      } else {
        setHistory(data ?? []);
      }
      setLoading(false);
    };

    fetchHistory();
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Automation History</h2>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <RefreshCw className="w-8 h-8 animate-spin mb-3" />
          <p>Loading history...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-red-50 text-red-700">
          Failed to load history: {error}
        </div>
      ) : history.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-gray-500">
            No automations yet. Start one from <span className="font-medium">New Video</span>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {history.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-center justify-between p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-gray-100 rounded-lg dark:bg-gray-800">
                    <Video className="w-6 h-6 text-gray-500" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold">
                      {item.generated_title || "Processing Error / Draft"}
                    </h3>
                    <div className="flex items-center text-sm text-gray-500 gap-2">
                      <span>URL: {item.youtube_url}</span>
                      <span>•</span>
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge
                    variant={
                      item.status === "COMPLETED"
                        ? "default"
                        : item.status === "FAILED"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {item.status}
                  </Badge>
                  <Link href={`/dashboard/preview/${item.id}`}>
                    <Button variant="ghost" size="icon">
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
