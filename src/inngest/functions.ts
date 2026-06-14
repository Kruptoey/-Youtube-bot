import { inngest } from "./client";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import youtubedl from "youtube-dl-exec";
import fs from "fs";
import path from "path";
import os from "os";

// Transcription AI (Google Gemini Native SDK)
import { GoogleGenerativeAI } from "@google/generative-ai";

// Brain AI (Vercel AI SDK)
import { generateObject } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export const processVideoFunction = inngest.createFunction(
  {
    id: "process-youtube-video",
    retries: 3,
    triggers: [{ event: "video/process.requested" }],
    // Runs only after all retries are exhausted: surface the failure to the user
    // by persisting FAILED + the error message instead of leaving the row stuck.
    onFailure: async ({ event, error }) => {
      const videoId = event?.data?.event?.data?.videoId;
      if (!videoId) return;
      await supabase
        .from("videos")
        .update({
          status: "FAILED",
          error_message: String(error?.message ?? error).slice(0, 1000),
        })
        .eq("id", videoId);
    },
  },
  async ({ event, step }) => {
    const { videoId, youtubeUrl, personaId } = event.data;

    // Fetch existing video record
    const { data: videoData } = await supabase.from("videos").select("*").eq("id", videoId).single();
    if (!videoData) throw new Error("Video not found");

    let transcript = videoData.transcript;

    // ==========================================
    // PHASE A: TRANSCRIPTION ("The Ears")
    // ==========================================
    if (!transcript) {
      await step.run("update-state-extracting", async () => {
        await supabase.from("videos").update({ status: "EXTRACTING_AUDIO" }).eq("id", videoId);
      });

      const audioFilePath = await step.run("extract-audio", async () => {
        const tempDir = os.tmpdir();
        const filename = `audio-${videoId}-${Date.now()}.mp3`;
        const filePath = path.join(tempDir, filename);
        
        try {
           await youtubedl(youtubeUrl, {
             extractAudio: true,
             audioFormat: "mp3",
             output: filePath,
             noCheckCertificates: true,
             noWarnings: true,
             addHeader: ["referer:youtube.com", "user-agent:Mozilla/5.0"]
           });
           return filePath;
        } catch (err: any) {
           throw new Error(`Failed to download audio: ${err.message}`);
        }
      });

      // Transcribe using Gemini 1.5 Flash (Cheapest & Fastest)
      transcript = await step.run("transcribe-audio", async () => {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const audioBuffer = fs.readFileSync(audioFilePath);
        
        const result = await model.generateContent([
          "Transcribe this audio precisely. Output only the transcription text, nothing else.",
          {
            inlineData: {
              mimeType: "audio/mp3",
              data: audioBuffer.toString("base64")
            }
          }
        ]);
        
        const text = result.response.text();
        
        // Save transcript to DB
        await supabase.from("videos").update({ transcript: text }).eq("id", videoId);
        
        // Cleanup file
        try { fs.unlinkSync(audioFilePath); } catch (e) {}

        return text;
      });
    }

    // ==========================================
    // PHASE B: GENERATION ("The Brain")
    // ==========================================
    await step.run("update-state-analyzing", async () => {
      await supabase.from("videos").update({ status: "AI_ANALYZING" }).eq("id", videoId);
    });

    const aiResult = await step.run("ai-analyze-multi-provider", async () => {
      // 1. Fetch Persona
      let persona = null;
      if (personaId) {
        const { data } = await supabase.from("ai_personas").select("*").eq("id", personaId).single();
        persona = data;
      }
      
      // Fallback if no persona or deleted
      if (!persona) {
        persona = {
          provider: "google",
          model: "gemini-1.5-pro",
          system_prompt: "You are an expert YouTube SEO specialist. Analyze this transcript and generate metadata."
        };
      }

      // 2. Initialize Vercel AI SDK Provider
      let aiModel;
      
      if (persona.provider === "openai") {
        if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing in environment variables.");
        const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
        aiModel = openai(persona.model); // e.g. 'gpt-4o'
      } 
      else if (persona.provider === "anthropic") {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is missing in environment variables.");
        const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        aiModel = anthropic(persona.model); // e.g. 'claude-3-5-sonnet-20240620'
      } 
      else { // default google
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing in environment variables.");
        const googleAI = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
        aiModel = googleAI(persona.model); // e.g. 'gemini-1.5-pro'
      }

      // 3. Define Zod Schema for Structured Output
      const seoSchema = z.object({
        title: z.string().describe("SEO optimized YouTube title (under 100 chars)"),
        description: z.string().describe("Detailed YouTube description with timestamps and hashtags"),
        tags: z.string().describe("Comma separated tags for YouTube"),
        thumbnailText: z.string().describe("2-4 words maximum, extremely catchy text for the thumbnail")
      });

      // 4. Generate Object (Robust, works across all models)
      const promptText = `
        System Rules:
        ${persona.system_prompt}
        
        Video Transcript:
        """
        ${transcript}
        """
        
        Please provide the optimized metadata for this video based strictly on the transcript provided.
      `;

      try {
        const { object } = await generateObject({
          model: aiModel,
          schema: seoSchema,
          prompt: promptText,
          maxOutputTokens: 2000,
          temperature: 0.7,
        });
        
        return object;
      } catch (e: any) {
        console.error("AI Generation failed:", e);
        throw new Error(`AI Provider [${persona.provider}] failed: ${e.message}`);
      }
    });

    // Step 6: Save results & update status
    await step.run("save-results", async () => {
      await supabase
        .from("videos")
        .update({
          generated_title: aiResult.title,
          generated_description: aiResult.description,
          generated_tags: aiResult.tags?.split(",").map((t: string) => t.trim()),
          generated_thumbnail_text: aiResult.thumbnailText,
          status: "PENDING_APPROVAL"
        })
        .eq("id", videoId);
    });

    return { success: true, videoId };
  }
);
