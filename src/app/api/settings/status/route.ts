import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("channel_settings")
      .select("id, access_token, refresh_token")
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Status API Error:", error);
      return NextResponse.json({ isConnected: false, error: error.message }, { status: 500 });
    }

    if (data && (data.access_token || data.refresh_token)) {
      return NextResponse.json({ isConnected: true });
    }

    return NextResponse.json({ isConnected: false });
  } catch (err: any) {
    return NextResponse.json({ isConnected: false, error: err.message }, { status: 500 });
  }
}
