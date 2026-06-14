"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleAuth = async (type: 'login' | 'signup') => {
    setLoading(true);
    setError(null);

    let authError;
    
    if (type === 'signup') {
      try {
        const res = await fetch("/api/auth/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        
        if (!res.ok) {
          authError = { message: data.error };
        } else {
          // If successful, automatically log them in
          const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
          authError = loginErr;
        }
      } catch (err: any) {
        authError = { message: err.message || "Failed to create account" };
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      authError = error;
    }

    if (authError) {
      setError(authError.message);
    } else {
      router.push("/dashboard");
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <Card className="w-[400px]">
        <CardHeader>
          <CardTitle>EazyCal AI Studio</CardTitle>
          <CardDescription>Sign in to manage YouTube automations</CardDescription>
        </CardHeader>
        <form>
          <CardContent className="space-y-4">
            {error && <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md">{error}</div>}
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@eazycal.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>
          
          <CardFooter className="flex flex-col space-y-3">
            <Button type="button" onClick={() => handleAuth('login')} className="w-full" disabled={loading}>
              {loading ? "Processing..." : "Sign In"}
            </Button>
            <div className="relative w-full text-center text-sm border-t pt-3 mt-3">
              <span className="text-gray-500">First time here?</span>
              <Button type="button" onClick={() => handleAuth('signup')} variant="outline" className="w-full mt-2" disabled={loading}>
                Create Admin Account
              </Button>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
