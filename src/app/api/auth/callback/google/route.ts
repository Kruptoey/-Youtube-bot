import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// Must exactly match the redirect URI registered in the Google Cloud Console
// and the one used in /api/auth/google. Shared via env to prevent drift.
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/callback/google";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // If user denied the request
  if (error) {
    console.error("OAuth Error:", error);
    return NextResponse.redirect(new URL("/dashboard/settings?error=access_denied", req.url));
  }

  // Verify State Token (CSRF Protection)
  const savedState = req.cookies.get("oauth_state")?.value;
  if (!state || state !== savedState) {
    console.error("CSRF Mismatch. Expected:", savedState, "Got:", state);
    return NextResponse.redirect(new URL("/dashboard/settings?error=csrf_failed", req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/settings?error=missing_code", req.url));
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      REDIRECT_URI
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.warn("No refresh token received. You may need to revoke app access in Google Account and try again.");
      // We will still save the access_token if possible, but we need the refresh_token ideally.
    }

    // Save tokens to Supabase
    const { data: existing, error: selectError } = await supabase
      .from("channel_settings")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (selectError) {
       console.error("Select Error:", selectError);
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("channel_settings")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || undefined,
          token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          channel_id: "eazycal-default",
          channel_name: "EazyCal"
        })
        .eq("id", existing.id);
        
        if (updateError) console.error("Supabase Update Error:", updateError);
    } else {
      const { error: insertError } = await supabase
        .from("channel_settings")
        .insert([{
          channel_id: "eazycal-default",
          channel_name: "EazyCal",
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
        }]);
        
        if (insertError) console.error("Supabase Insert Error:", insertError);
    }

    // Redirect to dashboard with success flag
    const response = NextResponse.redirect(new URL("/dashboard/settings?success=true", req.url));
    
    // Clear the state cookie
    response.cookies.delete("oauth_state");
    return response;

  } catch (err: any) {
    console.error("Token Exchange Error:", err);
    return NextResponse.redirect(new URL("/dashboard/settings?error=exchange_failed", req.url));
  }
}
