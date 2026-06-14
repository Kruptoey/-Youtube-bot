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
    const { videoId, youtubeUrl, personaId, qualityMode, directorsNote } = event.data;

    // ==========================================
    // PHASE A: TRANSCRIPTION (Google Gemini 1.5 Flash)
    // ==========================================
    await step.run("update-state-extracting", async () => {
      await supabase.from("videos").update({ status: "EXTRACTING_AUDIO" }).eq("id", videoId);
    });

    const transcript = await step.run("extract-and-transcribe", async () => {
      if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");

      const audioPath = path.join(os.tmpdir(), `${videoId}.mp3`);

      try {
        await youtubedl(youtubeUrl, {
          extractAudio: true,
          audioFormat: "mp3",
          output: audioPath,
          noCheckCertificates: true,
          noWarnings: true,
          addHeader: ["referer:youtube.com", "user-agent:googlebot"],
        });

        const audioBase64 = fs.readFileSync(audioPath).toString("base64");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent([
          { inlineData: { mimeType: "audio/mp3", data: audioBase64 } },
          { text: "Please transcribe this audio completely and accurately. Return only the transcript text, no timestamps or extra formatting." },
        ]);

        const transcriptText = result.response.text();

        await supabase.from("videos").update({ transcript: transcriptText }).eq("id", videoId);

        return transcriptText;
      } finally {
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      }
    });

    // ==========================================
    // PHASE B: GENERATION (The 6-Agent Virtual Agency)
    // ==========================================
    await step.run("update-state-analyzing", async () => {
      await supabase.from("videos").update({ status: "AI_ANALYZING" }).eq("id", videoId);
    });

    const aiResult = await step.run("ai-analyze-multi-agent", async () => {
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing for the Multi-Agent Pipeline.");
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const fastModel = openai("gpt-4o-mini");
      const smartModel = openai("gpt-4o");

      // 1. Fetch User Persona (The Creative Director)
      let creativeDirector = { system_prompt: "You are a master YouTube strategist aiming for high CTR and viral reach." };
      if (personaId) {
        const { data } = await supabase.from("ai_personas").select("*").eq("id", personaId).single();
        if (data) creativeDirector = data;
      }

      // Director's Note Injection
      const briefingInjection = directorsNote 
        ? `\n\nCRITICAL DIRECTOR's NOTE FOR THIS SPECIFIC VIDEO:\n"""\n${directorsNote}\n"""\nYou MUST adhere to this note above all other general instructions.`
        : "";

      // 2. Fetch Operational System Agents
      const { data: systemAgents } = await supabase.from("ai_personas").select("*").like("name", "System - %");
      
      const getSysPrompt = (name: string, defaultPrompt: string) => {
        const agent = systemAgents?.find(a => a.name === name);
        return (agent ? agent.system_prompt : defaultPrompt) + briefingInjection;
      };

      const analystPrompt = getSysPrompt("System - Analyst", "You are an elite Data & Audience Analyst. Extract the psychographic profile and core value proposition.");
      const seoPrompt = getSysPrompt("System - SEO", "You are a YouTube SEO Director. Write the perfect SEO description and tags.");
      const visualPrompt = getSysPrompt("System - Visuals", "You are a YouTube Art Director. Generate 3 extremely punchy thumbnail text options (2-4 words max) that create synergy and curiosity.");

      // ------------------------------------------
      // AGENT 1: The Analyst (Audience & Core Value)
      // ------------------------------------------
      const { object: analystOutput } = await generateObject({
        model: fastModel,
        schema: z.object({
          core_value: z.string().describe("The primary 'Aha!' moment or core lesson of the video."),
          target_audience: z.string().describe("Detailed psychographic profile of who would watch this."),
          pain_points: z.array(z.string()).describe("List of pain points this video solves for the audience.")
        }),
        prompt: `System: ${analystPrompt}\n\nTranscript: \n\n${transcript.substring(0, 15000)}`,
      });

      // ------------------------------------------
      // PARALLEL EXECUTION: SEO & Visual Hook
      // ------------------------------------------
      const [seoOutput, visualOutput] = await Promise.all([
        // AGENT 2: SEO Director
        generateObject({
          model: fastModel,
          schema: z.object({
            description: z.string().describe("A highly optimized 3-paragraph YouTube description focusing on the first 150 characters."),
            tags: z.array(z.string()).describe("15-20 high-volume, low-competition tags, specific to the topic.")
          }),
          prompt: `System: ${seoPrompt}\nAudience: ${JSON.stringify(analystOutput)}\nTranscript: ${transcript.substring(0, 5000)}`
        }),

        // AGENT 4: Visual Hook Designer
        generateObject({
          model: smartModel,
          schema: z.object({
            thumbnail_text_options: z.array(z.string()).describe("3 punchy, emotional, 2-3 word texts for the thumbnail.")
          }),
          prompt: `System: ${visualPrompt}\nAudience: ${JSON.stringify(analystOutput)}\nTranscript: ${transcript.substring(0, 3000)}`
        })
      ]);

      // ------------------------------------------
      // THE REFLECTION LOOP (Agents 3 & 5)
      // ------------------------------------------
      const maxLoops = qualityMode === "Maximize" ? 3 : 1;
      let currentLoop = 1;
      let finalWinner = null;
      let previousCritique = "No previous attempts.";

      while (currentLoop <= maxLoops) {
        // AGENT 3: Master Copywriter
        const { object: copywriterOutput } = await generateObject({
          model: smartModel,
          schema: z.object({
            fomo_title: z.string().describe("Title inducing Fear of Missing Out"),
            contrarian_title: z.string().describe("Title that goes against common beliefs"),
            secret_title: z.string().describe("Title focusing on a revealed secret"),
            transformation_title: z.string().describe("Title promising the ultimate transformation")
          }),
          prompt: `System: ${creativeDirector.system_prompt}${briefingInjection}\n
            You are drafting viral titles for this audience: ${JSON.stringify(analystOutput)}
            Previous Feedback (if any): ${previousCritique}
            Transcript summary: ${transcript.substring(0, 3000)}
            Create 4 unique titles under 60 chars.`
        });

        // AGENT 5: Red Team Critic
        const { object: criticOutput } = await generateObject({
          model: smartModel,
          schema: z.object({
            score: z.number().min(1).max(10).describe("Rate the best title from 1 to 10 based on CTR potential."),
            winning_title: z.string().describe("The absolute best title chosen from the 4 options, refined if necessary."),
            winning_thumbnail_text: z.string().describe("The best 2-3 word thumbnail text from options that perfectly complements the winning title."),
            critique: z.string().describe("If score is < 8, explain WHY it fails and what the copywriter must change.")
          }),
          prompt: `System: ${creativeDirector.system_prompt}${briefingInjection}\n
            You are the Executive Critic. Your standard for an 8/10 is absolute perfection, immense curiosity gap, and ZERO boring academic tone.
            Review these titles: ${JSON.stringify(copywriterOutput)}
            Review these thumbnail text options: ${JSON.stringify(visualOutput.object.thumbnail_text_options)}
            Select the best combination. If it doesn't give you goosebumps, give it a score lower than 8 and provide a harsh critique.`
        });

        if (criticOutput.score >= 8 || currentLoop === maxLoops) {
          finalWinner = criticOutput;
          break; // Loop satisfied!
        } else {
          previousCritique = criticOutput.critique;
          currentLoop++;
        }
      }

      // ------------------------------------------
      // POST-PROCESSING: Social Media Squad
      // ------------------------------------------
      let finalDescription = seoOutput.object.description;
      
      const { data: socialAgents } = await supabase.from("ai_personas").select("*").like("name", "Social - %");
      
      if (socialAgents && socialAgents.length > 0) {
        const socialPromises = socialAgents.map(async (agent) => {
          const { object: socialOutput } = await generateObject({
            model: fastModel,
            schema: z.object({
              content: z.string().describe("The generated social media content formatted perfectly for the platform.")
            }),
            prompt: `System: ${agent.system_prompt}${briefingInjection}\n
              You are part of the Social Media Squad. 
              Create a post for this platform based on this YouTube video.
              Winning Title: ${finalWinner!.winning_title}
              Audience: ${JSON.stringify(analystOutput)}
              Transcript: ${transcript.substring(0, 3000)}`
          });
          return `\n\n---\n🔥 **${agent.name.replace("Social - ", "")}**\n\n${socialOutput.content}`;
        });

        const socialResults = await Promise.all(socialPromises);
        finalDescription += "\n\n=========================================\n📲 SOCIAL MEDIA SQUAD CONTENT\n=========================================" + socialResults.join("");
      }

      // ------------------------------------------
      // AGENT 6: Data Architect (Final Formatting)
      // ------------------------------------------
      return {
        title: finalWinner!.winning_title,
        description: finalDescription,
        tags: seoOutput.object.tags.join(", "),
        thumbnailText: finalWinner!.winning_thumbnail_text
      };
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
