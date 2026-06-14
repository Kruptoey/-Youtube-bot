-- SQL Schema for EazyCal YouTube AI Automation (Supabase) - PHASE 3 UPDATE

-- 1. Table: videos
CREATE TABLE IF NOT EXISTS public.videos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    youtube_url TEXT NOT NULL,
    video_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    original_title TEXT,
    original_description TEXT,
    original_tags TEXT[],
    generated_title TEXT,
    generated_description TEXT,
    generated_tags TEXT[],
    generated_thumbnail_text TEXT,
    transcript TEXT,          -- Raw transcript produced by the transcription step
    persona_id UUID,          -- AI persona used for generation (FK added in Phase 3 block below)
    selected_asset_id UUID, -- Links to the chosen image for the thumbnail
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER videos_updated_at_trigger
    BEFORE UPDATE ON public.videos
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_updated_at();

-- 2. Table: channel_settings
CREATE TABLE IF NOT EXISTS public.channel_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    channel_id TEXT NOT NULL,
    channel_name TEXT,
    access_token TEXT,
    refresh_token TEXT, -- In prod, use Supabase Vault: vault.secrets
    token_expiry TIMESTAMP WITH TIME ZONE,
    system_prompt TEXT DEFAULT 'You are an expert YouTube SEO specialist for EazyCal...',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TRIGGER channel_settings_updated_at_trigger
    BEFORE UPDATE ON public.channel_settings
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_updated_at();

-- 3. Table: assets (For Kruptoey Images)
CREATE TABLE IF NOT EXISTS public.assets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    public_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Table: ai_personas (Multi-provider "Brain" configuration)
CREATE TABLE IF NOT EXISTS public.ai_personas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL DEFAULT 'google'
        CHECK (provider IN ('google', 'openai', 'anthropic')),
    model TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_personas ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow authenticated full access videos" ON public.videos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access channel_settings" ON public.channel_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access assets" ON public.assets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated read personas" ON public.ai_personas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated manage personas" ON public.ai_personas FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- PHASE 3 MIGRATION (idempotent — safe to re-run on an existing database)
-- ============================================================================

-- Columns added in Phase 3 (no-op if the CREATE TABLE above already created them)
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS persona_id UUID;

-- Referential integrity: a deleted persona simply detaches from its videos.
-- The worker (src/inngest/functions.ts) already falls back to a default persona
-- when persona_id is null, so ON DELETE SET NULL is the correct, non-breaking choice.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'videos_persona_id_fkey'
    ) THEN
        ALTER TABLE public.videos
            ADD CONSTRAINT videos_persona_id_fkey
            FOREIGN KEY (persona_id) REFERENCES public.ai_personas(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Seed one default persona so the dashboard selector is never empty.
INSERT INTO public.ai_personas (name, provider, model, system_prompt)
VALUES (
    'EazyCal Default (Gemini)',
    'google',
    'gemini-1.5-pro',
    'You are an expert YouTube SEO specialist for EazyCal, an educational channel. Analyze the transcript and generate metadata that is accurate, engaging, and optimized for search.'
)
ON CONFLICT (name) DO NOTHING;
