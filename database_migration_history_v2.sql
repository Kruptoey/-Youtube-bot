-- ============================================================================
-- HISTORY v2 — AI cost tracking (idempotent, safe to re-run)
--
-- Adds the columns the History worklist needs to show the real AI spend per job.
-- Values are written by the worker (src/inngest/functions.ts) using the centralized
-- price table in src/lib/ai-cost.ts. All columns are nullable so existing rows and
-- the legacy template path keep working unchanged.
-- ============================================================================

ALTER TABLE public.videos
  -- Total estimated AI spend for the whole job, in USD (transcription + the
  -- generation agents + the thumbnail image). 4 decimals = down to $0.0001.
  ADD COLUMN IF NOT EXISTS ai_cost_usd NUMERIC(10, 4),
  -- Per-step breakdown + per-model totals, for auditing and a future detail view:
  --   { "entries": [{ step, model, inputTokens, outputTokens, images, costUsd }],
  --     "byModel": { "<model>": costUsd }, "totalUsd": <number> }
  ADD COLUMN IF NOT EXISTS ai_usage JSONB,
  -- The single most expensive model used, for the History row badge (e.g. the
  -- raw id "claude-sonnet-4-6"; the UI prettifies it to "Sonnet 4.6").
  ADD COLUMN IF NOT EXISTS ai_model TEXT;

-- History lists are always ordered by created_at DESC; this keeps that fast as the
-- table grows.
CREATE INDEX IF NOT EXISTS videos_created_at_idx
  ON public.videos (created_at DESC);
