import { google } from "googleapis";
import { NextResponse } from "next/server";
import crypto from "crypto";

// Must exactly match the redirect URI registered in the Google Cloud Console
// and the one used in /api/auth/callback/google. Shared via env to prevent drift.
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/callback/google";

export async function GET() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    REDIRECT_URI
  );

  // Generate a random state token to prevent CSRF
  const state = crypto.randomBytes(32).toString("hex");

  // Generate a secure url
  const url = oauth2Client.generateAuthUrl({
    // 'online' (default) or 'offline' (gets refresh_token)
    access_type: "offline",
    
    // Forces the consent screen so we get a refresh_token every time (Google Gold Standard)
    prompt: "consent",

    // Pass the state token
    state: state,

    // If you only need one scope you can pass it as a string
    scope: ["https://www.googleapis.com/auth/youtube.force-ssl"],
  });

  // Redirect the user to the generated URL, passing the state in a cookie for later verification
  const response = NextResponse.redirect(url);
  
  // Set HttpOnly cookie for CSRF protection
  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  });

  return response;
}
