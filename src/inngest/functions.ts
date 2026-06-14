import { inngest } from "./client";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import youtubedl, { type Payload } from "youtube-dl-exec";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";
import path from "path";
import os from "os";

// Transcription AI (Google Gemini Native SDK)
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

// Brain AI (Vercel AI SDK)
import { generateObject } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

type CaptionTrack = { ext: string; url: string; name?: string };

/**
 * Clean a WebVTT caption file down to plain text: strip the header, timestamp
 * cues, cue indices, and inline tags, and collapse the rolling-duplicate lines
 * that auto-captions emit.
 */
function cleanVtt(vtt: string): string {
  const out: string[] = [];
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("WEBVTT") || line.startsWith("Kind:") || line.startsWith("Language:")) continue;
    if (line.includes("-->")) continue; // timestamp cue
    if (/^\d+$/.test(line)) continue; // cue index
    const text = line.replace(/<[^>]+>/g, "").trim(); // strip inline tags
    if (text && text !== out[out.length - 1]) out.push(text); // de-dupe rolling lines
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Use YouTube's own captions instead of extracting + transcribing audio.
 *
 * Returns clean transcript text, or null if no usable captions exist — the caller
 * then falls back to the audio + Gemini path. This skips the audio download, ffmpeg,
 * and the Gemini call entirely: typically seconds and free instead of minutes and paid.
 * Human-authored subtitles are preferred over auto-generated captions.
 */
async function fetchYouTubeCaptions(youtubeUrl: string): Promise<string | null> {
  const meta = (await youtubedl(youtubeUrl, {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
    noCheckCertificates: true,
    addHeader: ["referer:youtube.com", "user-agent:googlebot"],
  })) as Payload;

  const manual = (meta.subtitles ?? {}) as Record<string, CaptionTrack[]>;
  const auto = (meta.automatic_captions ?? {}) as Record<string, CaptionTrack[]>;

  // Language preference: env list → the video's own language → first available.
  const preferred = (process.env.SUBTITLE_LANGS ?? "en,th")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const pickLang = (tracks: Record<string, CaptionTrack[]>): string | null => {
    const langs = Object.keys(tracks);
    if (langs.length === 0) return null;
    for (const p of preferred) {
      const hit = langs.find((l) => l === p || l.startsWith(`${p}-`));
      if (hit) return hit;
    }
    if (meta.language && langs.includes(meta.language as string)) return meta.language as string;
    return langs[0];
  };

  // Prefer human-authored subtitles; fall back to auto-generated captions.
  let source = manual;
  let lang = pickLang(manual);
  if (!lang) {
    source = auto;
    lang = pickLang(auto);
  }
  if (!lang) return null;

  // json3 is structured and parses cleanly; vtt is the fallback.
  const tracks = source[lang] ?? [];
  const track =
    tracks.find((t) => t.ext === "json3") ?? tracks.find((t) => t.ext === "vtt") ?? tracks[0];
  if (!track?.url) return null;

  const res = await fetch(track.url);
  if (!res.ok) return null;

  let text: string;
  if (track.ext === "json3") {
    const j = (await res.json()) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    text = (j.events ?? [])
      .flatMap((e) => (e.segs ?? []).map((s) => s.utf8 ?? ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  } else {
    text = cleanVtt(await res.text());
  }

  return text.length > 0 ? text : null;
}

/**
 * Download a YouTube video's audio track to `audioPath` as a small 16 kHz mono mp3.
 *
 * Idempotent "staging": if the file already exists on disk we skip the download.
 * Combined with splitting download/transcribe into separate Inngest steps, this
 * means a transcription retry never re-downloads — Inngest replays the memoized
 * download step, and even a fresh attempt finds the staged file. The downsample to
 * 16 kHz mono keeps the upload to Gemini small without hurting speech accuracy.
 *
 * NOTE (production/serverless): os.tmpdir() is ephemeral and not shared across
 * invocations/machines. For a multi-machine deploy, stage to Supabase Storage and
 * key by videoId instead — this helper is the single place to swap that in.
 */
async function ensureAudio(youtubeUrl: string, audioPath: string): Promise<void> {
  if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0) return; // already staged
  if (!ffmpegStatic) throw new Error("ffmpeg-static binary not found — run `npm install`.");

  // The generation agents only consume the first ~15k transcript chars (see Phase B),
  // so transcribing an entire long lecture is wasted time and cost. Cap the audio to
  // the first N minutes (default 25 — comfortable headroom over the 15k-char budget).
  // Set TRANSCRIBE_MAX_MINUTES=0 to transcribe the full video.
  const maxMinutes = Number(process.env.TRANSCRIBE_MAX_MINUTES ?? 25);

  await youtubedl(youtubeUrl, {
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: 5, // VBR ~64-96kbps — ample for transcription, much smaller than default
    output: audioPath,
    ffmpegLocation: ffmpegStatic,
    postprocessorArgs: "ExtractAudio:-ar 16000 -ac 1", // 16kHz mono: smaller upload, faster transcribe
    ...(maxMinutes > 0 ? { downloadSections: `*0-${maxMinutes * 60}` } : {}),
    noCheckCertificates: true,
    noWarnings: true,
    addHeader: ["referer:youtube.com", "user-agent:googlebot"],
  });
}

const TRANSCRIPTION_PROMPT =
  "Please transcribe this audio completely and accurately. Return only the transcript text, no timestamps or extra formatting.";

// Inline base64 inflates the payload ~33% and Gemini caps a single request at 20MB.
// Below this raw-file threshold, inline is the faster path (one round-trip); above it
// we must use the resumable File API. 14MB raw ≈ 18.7MB base64, safely under the cap.
const INLINE_MAX_BYTES = 14 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Transcribe a local mp3 with Gemini, choosing the optimal transport by file size:
 *  - small files  → inline base64 (single request, lowest latency)
 *  - large files  → File API upload + reference (no 20MB limit, robust for long audio)
 */
async function transcribeWithGemini(audioPath: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const { size } = fs.statSync(audioPath);

  // ---- Fast path: small file, inline base64 ----
  if (size <= INLINE_MAX_BYTES) {
    const audioBase64 = fs.readFileSync(audioPath).toString("base64");
    const result = await model.generateContent([
      { inlineData: { mimeType: "audio/mp3", data: audioBase64 } },
      { text: TRANSCRIPTION_PROMPT },
    ]);
    return result.response.text();
  }

  // ---- Robust path: large file, File API ----
  const fileManager = new GoogleAIFileManager(apiKey);
  const upload = await fileManager.uploadFile(audioPath, {
    mimeType: "audio/mp3",
    displayName: path.basename(audioPath),
  });

  try {
    // Poll until the file finishes server-side processing (bounded ~2 min).
    let file = upload.file;
    for (let i = 0; file.state === FileState.PROCESSING && i < 60; i++) {
      await sleep(2000);
      file = await fileManager.getFile(file.name);
    }
    if (file.state !== FileState.ACTIVE) {
      throw new Error(`Gemini file processing did not complete (state: ${file.state}).`);
    }

    const result = await model.generateContent([
      { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
      { text: TRANSCRIPTION_PROMPT },
    ]);
    return result.response.text();
  } finally {
    // Files auto-expire after 48h, but delete eagerly to stay tidy.
    await fileManager.deleteFile(upload.file.name).catch(() => {});
  }
}

// ---- Phase B profiling (opt-in via PHASE_B_PROFILE=1) ----------------------
// Each agent runs inside one Inngest step, so the dashboard only shows the total.
// This thin wrapper logs per-agent wall-clock + token usage so we can see which
// agent is the bottleneck before deciding how to optimize. Zero overhead when off.
const PHASE_B_PROFILE = process.env.PHASE_B_PROFILE === "1";

function plog(msg: string) {
  if (PHASE_B_PROFILE) console.log(`[phaseB] ${msg}`);
}

async function timedGen<T extends { usage?: { inputTokens?: number; outputTokens?: number } }>(
  label: string,
  p: Promise<T>,
): Promise<T> {
  if (!PHASE_B_PROFILE) return p;
  const t0 = Date.now();
  const res = await p;
  const u = res.usage ?? {};
  plog(
    `${label.padEnd(20)} ${String(Date.now() - t0).padStart(6)}ms  in=${u.inputTokens ?? "?"} out=${u.outputTokens ?? "?"}`,
  );
  return res;
}

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
    // Layer 3 — cross-run resume: if a transcript already exists in the DB (e.g. a
    // re-submitted videoId or a fresh invocation after Phase B failed), skip Phase A
    // entirely. Steps are also memoized within a run, so this mainly helps new runs.
    const cachedTranscript = await step.run("check-cached-transcript", async () => {
      const { data } = await supabase
        .from("videos")
        .select("transcript")
        .eq("id", videoId)
        .maybeSingle();
      return data?.transcript ?? null;
    });

    let transcript: string;

    if (cachedTranscript && cachedTranscript.trim().length > 0) {
      transcript = cachedTranscript;
    } else {
      await step.run("update-state-extracting", async () => {
        await supabase.from("videos").update({ status: "EXTRACTING_AUDIO" }).eq("id", videoId);
      });

      // Fast path — use YouTube's own captions when available: seconds and free,
      // versus minutes and paid for the audio+Gemini path. Set PREFER_CAPTIONS=0 to
      // always transcribe audio (e.g. if you need Gemini-grade transcript quality).
      // Caption-fetch failures are non-fatal: we just fall back to audio.
      const captionTranscript =
        process.env.PREFER_CAPTIONS === "0"
          ? null
          : await step.run("fetch-captions", async () => {
              try {
                const text = await fetchYouTubeCaptions(youtubeUrl);
                if (text) await supabase.from("videos").update({ transcript: text }).eq("id", videoId);
                return text;
              } catch (e) {
                console.warn("[captions] fetch failed, falling back to audio:", (e as Error).message);
                return null;
              }
            });

      if (captionTranscript && captionTranscript.trim().length > 0) {
        transcript = captionTranscript;
      } else {
        // Fallback path: extract audio and transcribe with Gemini.
        const audioPath = path.join(os.tmpdir(), `${videoId}.mp3`);

        // Separate download step: its result is memoized by Inngest, so a failure in
        // the transcription step below never triggers a re-download.
        await step.run("download-audio", async () => {
          await ensureAudio(youtubeUrl, audioPath);
          return audioPath;
        });

        // Transcription step: self-heals via ensureAudio() if the staged file is gone.
        transcript = await step.run("transcribe-audio", async () => {
          await ensureAudio(youtubeUrl, audioPath); // re-stage if file vanished between steps

          const transcriptText = await transcribeWithGemini(audioPath);

          await supabase.from("videos").update({ transcript: transcriptText }).eq("id", videoId);

          // Clean up only on success — leaving the file on failure lets a retry reuse it.
          try {
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
          } catch {
            /* best-effort cleanup */
          }

          return transcriptText;
        });
      }
    }

    // ==========================================
    // PHASE B: GENERATION (The 6-Agent Virtual Agency)
    // ==========================================
    await step.run("update-state-analyzing", async () => {
      await supabase.from("videos").update({ status: "AI_ANALYZING" }).eq("id", videoId);
    });

    const aiResult = await step.run("ai-analyze-multi-agent", async () => {
      const phaseBStart = Date.now();
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set in .env.local — required for the Multi-Agent Pipeline. Add it and restart the dev server.");
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
      const { object: analystOutput } = await timedGen("analyst", generateObject({
        model: fastModel,
        schema: z.object({
          core_value: z.string().describe("The primary 'Aha!' moment or core lesson of the video."),
          target_audience: z.string().describe("Detailed psychographic profile of who would watch this."),
          pain_points: z.array(z.string()).describe("List of pain points this video solves for the audience.")
        }),
        prompt: `System: ${analystPrompt}\n\nTranscript: \n\n${transcript.substring(0, 15000)}`,
      }));

      // ------------------------------------------
      // PARALLEL EXECUTION: SEO & Visual Hook
      // ------------------------------------------
      const parallelStart = Date.now();
      const [seoOutput, visualOutput] = await Promise.all([
        // AGENT 2: SEO Director
        timedGen("seo", generateObject({
          model: fastModel,
          schema: z.object({
            description: z.string().describe("A highly optimized 3-paragraph YouTube description focusing on the first 150 characters."),
            tags: z.array(z.string()).describe("15-20 high-volume, low-competition tags, specific to the topic.")
          }),
          prompt: `System: ${seoPrompt}\nAudience: ${JSON.stringify(analystOutput)}\nTranscript: ${transcript.substring(0, 5000)}`
        })),

        // AGENT 4: Visual Hook Designer
        timedGen("visual", generateObject({
          model: smartModel,
          schema: z.object({
            thumbnail_text_options: z.array(z.string()).describe("3 punchy, emotional, 2-3 word texts for the thumbnail.")
          }),
          prompt: `System: ${visualPrompt}\nAudience: ${JSON.stringify(analystOutput)}\nTranscript: ${transcript.substring(0, 3000)}`
        }))
      ]);
      plog(`seo‖visual block ${String(Date.now() - parallelStart).padStart(6)}ms (wall-clock of the parallel pair)`);

      // ------------------------------------------
      // THE REFLECTION LOOP (Agents 3 & 5)
      // ------------------------------------------
      const maxLoops = qualityMode === "Maximize" ? 3 : 1;
      let currentLoop = 1;
      let finalWinner = null;
      let previousCritique = "No previous attempts.";

      while (currentLoop <= maxLoops) {
        // AGENT 3: Master Copywriter
        const { object: copywriterOutput } = await timedGen(`copywriter#${currentLoop}`, generateObject({
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
        }));

        // AGENT 5: Red Team Critic
        const { object: criticOutput } = await timedGen(`critic#${currentLoop}`, generateObject({
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
        }));

        plog(`loop ${currentLoop}/${maxLoops} → critic score ${criticOutput.score}`);

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
        const socialStart = Date.now();
        const socialPromises = socialAgents.map(async (agent) => {
          const { object: socialOutput } = await timedGen(`social:${agent.name.replace("Social - ", "")}`, generateObject({
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
          }));
          return `\n\n---\n🔥 **${agent.name.replace("Social - ", "")}**\n\n${socialOutput.content}`;
        });

        const socialResults = await Promise.all(socialPromises);
        plog(`social squad (${socialAgents.length} agents) ${String(Date.now() - socialStart).padStart(6)}ms wall-clock`);
        finalDescription += "\n\n=========================================\n📲 SOCIAL MEDIA SQUAD CONTENT\n=========================================" + socialResults.join("");
      }

      // ------------------------------------------
      // AGENT 6: Data Architect (Final Formatting)
      // ------------------------------------------
      plog(`TOTAL Phase B ${String(Date.now() - phaseBStart).padStart(6)}ms`);
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
