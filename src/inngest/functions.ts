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

// AI thumbnail pipeline (Art Director → scene → composite → QC). Degrades gracefully.
import { produceThumbnail } from "@/lib/thumbnail";

// AI cost accounting — see src/lib/ai-cost.ts. Entries are returned out of each
// Inngest step (never carried in closure state) so replays preserve them.
import { AiCost, type AiCostEntry } from "@/lib/ai-cost";

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

/** Token usage from a Gemini native-SDK response, mapped to the common in/out shape. */
function geminiUsage(result: { response: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } } }): {
  inputTokens: number;
  outputTokens: number;
} {
  const m = result.response.usageMetadata;
  return { inputTokens: m?.promptTokenCount ?? 0, outputTokens: m?.candidatesTokenCount ?? 0 };
}

/**
 * Transcribe a local mp3 with Gemini, choosing the optimal transport by file size:
 *  - small files  → inline base64 (single request, lowest latency)
 *  - large files  → File API upload + reference (no 20MB limit, robust for long audio)
 *
 * Returns the transcript plus token usage so the caller can account for the cost.
 */
async function transcribeWithGemini(
  audioPath: string
): Promise<{ text: string; model: string; usage: { inputTokens: number; outputTokens: number } }> {
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
    return { text: result.response.text(), model: modelName, usage: geminiUsage(result) };
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
    return { text: result.response.text(), model: modelName, usage: geminiUsage(result) };
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

/**
 * Bound a promise so a hung network/AI call can never freeze a step forever.
 * On timeout it REJECTS (the loser fetch keeps running in the background harmlessly);
 * the caller's try/catch then lets the pipeline proceed to PENDING_APPROVAL.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
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
    const { videoId, youtubeUrl, personaId, qualityMode, directorsNote, thumbnailRefUrl } = event.data;

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
    // Cost entries are collected per step and returned as step values (Inngest-safe);
    // they are merged and persisted in the finalize step. Captions/cache cost nothing.
    let transcriptCostEntries: AiCostEntry[] = [];

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
        const transcribed = await step.run("transcribe-audio", async () => {
          await ensureAudio(youtubeUrl, audioPath); // re-stage if file vanished between steps

          const { text, model, usage } = await transcribeWithGemini(audioPath);

          await supabase.from("videos").update({ transcript: text }).eq("id", videoId);

          // Clean up only on success — leaving the file on failure lets a retry reuse it.
          try {
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
          } catch {
            /* best-effort cleanup */
          }

          const c = new AiCost();
          c.addTokens("transcription", model, usage);
          return { text, entries: c.entries };
        });
        transcript = transcribed.text;
        transcriptCostEntries = transcribed.entries;
      }
    }

    // ==========================================
    // PHASE B: GENERATION (The 6-Agent Virtual Agency)
    // ==========================================
    await step.run("update-state-analyzing", async () => {
      await supabase.from("videos").update({ status: "AI_ANALYZING" }).eq("id", videoId);
    });

    const aiResult = await step.run("ai-analyze-mega-pipeline", async () => {
      const phaseBStart = Date.now();
      const cost = new AiCost();

      // Brain models. Anthropic is preferred for structured copywriting; OpenAI is the
      // fallback. Model IDs are env-overridable so a retired alias never bricks the
      // pipeline again (the old "claude-3-5-sonnet-latest" default did exactly that).
      // Defaults are the current, faster-and-smarter generation.
      const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
      const hasOpenAI = !!process.env.OPENAI_API_KEY;

      if (!hasAnthropic && !hasOpenAI) {
        throw new Error("Missing AI API Key. Please set ANTHROPIC_API_KEY (recommended) or OPENAI_API_KEY in .env.local");
      }

      let megaModel, fastModel;
      let megaModelId: string, fastModelId: string;
      if (hasAnthropic) {
        const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        megaModelId = process.env.ANTHROPIC_MEGA_MODEL || "claude-sonnet-4-6";
        fastModelId = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5-20251001";
        megaModel = anthropic(megaModelId);
        fastModel = anthropic(fastModelId);
      } else {
        const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
        megaModelId = process.env.OPENAI_MEGA_MODEL || "gpt-4o";
        fastModelId = process.env.OPENAI_FAST_MODEL || "gpt-4o-mini";
        megaModel = openai(megaModelId);
        fastModel = openai(fastModelId);
      }

      // 1. Fetch User Persona (The Creative Director)
      let creativeDirector = { system_prompt: "You are a master YouTube strategist aiming for high CTR and viral reach." };
      if (personaId) {
        const { data } = await supabase.from("ai_personas").select("*").eq("id", personaId).single();
        if (data) creativeDirector = data;
      }

      // Director's Note Injection
      const briefingInjection = directorsNote 
        ? `\n\nCRITICAL DIRECTOR'S NOTE FOR THIS SPECIFIC VIDEO:\n"""\n${directorsNote}\n"""\nYou MUST adhere to this note above all other general instructions.`
        : "";

      // ------------------------------------------
      // HOP 1: MASTER STRATEGIST + EXECUTIVE JUDGE (SINGLE MEGA-CALL)
      // ------------------------------------------
      // Analyst, SEO, visual hooks, Best-of-N titles AND the winner selection are all
      // produced in ONE structured call. Merging the old separate "judge" round-trip
      // saves a full model latency while improving quality: the model picks the winner
      // with the full audience + every candidate in one coherent reasoning context.
      const megaRes = await timedGen("mega-call", generateObject({
        model: megaModel,
        schema: z.object({
          analyst: z.object({
            core_value: z.string().describe("The primary 'Aha!' moment or core lesson of the video."),
            target_audience: z.string().describe("Detailed psychographic profile of who would watch this."),
            pain_points: z.array(z.string()).describe("List of pain points this video solves for the audience.")
          }),
          seo: z.object({
            description: z.string().describe("A highly optimized 3-paragraph YouTube description focusing on the first 150 characters."),
            tags: z.array(z.string()).describe("15-20 high-volume, low-competition tags, specific to the topic.")
          }),
          visual_hooks: z.array(z.string()).min(3).describe("3 punchy, emotional, 2-4 word texts for the thumbnail."),
          best_of_n_titles: z.array(z.object({
            style: z.string().describe("Psychological angle (e.g., FOMO, Contrarian, Curiosity, Story, Secret)."),
            title: z.string().describe("The actual title, under 60 characters, highly viral.")
          })).min(6).max(7).describe("Generate 6-7 DISTINCT, highly viral titles (no near-duplicates)."),
          winning_title: z.string().describe("Acting as a ruthless Red Team critic, the single best title from your options — refine it for maximum CTR and curiosity gap, zero boring tone."),
          winning_thumbnail_text: z.string().describe("The thumbnail text (from visual_hooks, refined) that best complements the winning title."),
          selection_reasoning: z.string().describe("One sentence on why this title+thumbnail combo has the highest CTR potential.")
        }),
        prompt: `System: ${creativeDirector.system_prompt}${briefingInjection}\n
          You are an elite Master Strategist AND your own Red Team critic.
          Step 1 — analyze the transcript and produce the audience profile, SEO, visual hooks, and 6-7 distinct viral titles.
          Step 2 — critique your own options and SELECT the single best title + matching thumbnail text, refining them for maximum CTR.
          Ensure absolute synergy between audience, SEO, hooks, titles, and the final winner.

          Transcript:
          ${transcript.substring(0, 12000)}`
      }));
      const megaOutput = megaRes.object;
      cost.addTokens("mega-call", megaModelId, megaRes.usage);

      plog(`Mega-Call (+judge) completed. Winner: ${megaOutput.winning_title}`);

      // ------------------------------------------
      // HOP 2 (PARALLEL): SOCIAL MEDIA SQUAD
      // ------------------------------------------
      let finalDescription = megaOutput.seo.description;
      const { data: socialAgents } = await supabase.from("ai_personas").select("*").like("name", "Social - %");
      
      if (socialAgents && socialAgents.length > 0) {
        const socialStart = Date.now();
        const socialPromises = socialAgents.map(async (agent) => {
          const shortName = agent.name.replace("Social - ", "");
          const socialRes = await timedGen(`social:${shortName}`, generateObject({
            model: fastModel,
            schema: z.object({
              content: z.string().describe("The generated social media content formatted perfectly for the platform.")
            }),
            prompt: `System: ${agent.system_prompt}${briefingInjection}\n
              You are part of the Social Media Squad. Create a highly engaging post based on this winning angle.
              Winning Title: ${megaOutput.winning_title}
              Audience: ${JSON.stringify(megaOutput.analyst)}
              Core Value: ${megaOutput.analyst.core_value}
              Note: Do not need to read the full transcript, just adapt the core value to fit the platform style.`
          }));
          cost.addTokens(`social:${shortName}`, fastModelId, socialRes.usage);
          return `\n\n---\n🔥 **${shortName}**\n\n${socialRes.object.content}`;
        });

        const socialResults = await Promise.all(socialPromises);
        plog(`social squad (${socialAgents.length} agents) ${String(Date.now() - socialStart).padStart(6)}ms wall-clock`);
        finalDescription += "\n\n=========================================\n📲 SOCIAL MEDIA SQUAD CONTENT\n=========================================" + socialResults.join("");
      }

      plog(`TOTAL Phase B ${String(Date.now() - phaseBStart).padStart(6)}ms`);
      return {
        title: megaOutput.winning_title,
        description: finalDescription,
        tags: megaOutput.seo.tags.join(", "),
        thumbnailText: megaOutput.winning_thumbnail_text,
        analyst: megaOutput.analyst,
        costEntries: cost.entries,
      };
    });

    // Step 6: Save text results. Status → GENERATING_THUMBNAIL so the preview keeps
    // polling while the (slower) image pipeline runs; we flip to PENDING_APPROVAL once
    // the thumbnail is ready.
    await step.run("save-results", async () => {
      await supabase
        .from("videos")
        .update({
          generated_title: aiResult.title,
          generated_description: aiResult.description,
          generated_tags: aiResult.tags?.split(",").map((t: string) => t.trim()),
          generated_thumbnail_text: aiResult.thumbnailText,
          status: "GENERATING_THUMBNAIL"
        })
        .eq("id", videoId);
    });

    // Step 7: AI thumbnail (Art Director → scene → composite → QC). NON-FATAL — any
    // failure leaves the scene/brief unset and /api/og falls back to the legacy
    // template, so the user always gets a usable thumbnail and the pipeline never
    // dies over a thumbnail.
    const thumbStep = await step.run("generate-thumbnail", async () => {
      const c = new AiCost();
      try {
        // Hard deadline so a hung image/AI call can never leave the video stuck on
        // GENERATING_THUMBNAIL. On timeout we degrade to the /api/og template.
        await withTimeout(
          produceThumbnail({
            videoId,
            transcript,
            analyst: aiResult.analyst,
            thumbnailText: aiResult.thumbnailText,
            title: aiResult.title,
            directorsNote,
            qualityMode,
            refUrl: thumbnailRefUrl || null,
            cost: c,
          }),
          Number(process.env.THUMBNAIL_TIMEOUT_MS) || 180000,
          "thumbnail pipeline"
        );
      } catch (e) {
        console.error("[thumbnail] pipeline failed/timed out (non-fatal):", e);
      }
      // Whatever was recorded before any failure is still billed (brief/scene/QC run
      // in order), so partial work is accounted for.
      return { entries: c.entries };
    });

    // Step 8: Persist the total AI spend, then hand off to the user for review. Cost
    // entries were returned out of each step (Inngest-safe) and are merged here.
    await step.run("finalize-pending", async () => {
      const total = AiCost.fromEntries([
        ...transcriptCostEntries,
        ...aiResult.costEntries,
        ...thumbStep.entries,
      ]);
      await supabase
        .from("videos")
        .update({
          status: "PENDING_APPROVAL",
          ai_cost_usd: total.totalUsd,
          ai_usage: total.summary(),
          ai_model: total.primaryModel,
        })
        .eq("id", videoId);
    });

    return { success: true, videoId };
  }
);
