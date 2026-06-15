-- ============================================================================
-- THUMBNAIL AI PIPELINE — Migration (idempotent, safe to re-run)
-- See docs/thumbnail-ai-design.md for the full design.
--
-- Adds the columns + library table the AI thumbnail pipeline needs.
-- Storage REUSES the existing `assets` bucket under a `thumbnails/` prefix,
-- so no new bucket has to be provisioned.
-- ============================================================================

-- 1. videos: thumbnail pipeline outputs ---------------------------------------
ALTER TABLE public.videos
  -- Final composited PNG (scene + text) uploaded to storage; what we ship to YouTube.
  ADD COLUMN IF NOT EXISTS generated_thumbnail_url TEXT,
  -- The AI-generated scene (background + subject, NO text) before compositing.
  ADD COLUMN IF NOT EXISTS generated_thumbnail_scene_url TEXT,
  -- Art Director structured brief (scene/palette/layout/text_layers/needs_custom_scene).
  ADD COLUMN IF NOT EXISTS thumbnail_brief JSONB,
  -- QC vision verdict (pass/legible/face_ok/balanced/issues) of the final image.
  ADD COLUMN IF NOT EXISTS thumbnail_qc JSONB,
  -- Optional per-video reference image (style or subject) supplied by the user.
  ADD COLUMN IF NOT EXISTS thumbnail_ref_url TEXT;

-- 2. thumbnail_backgrounds: the reusable scene Library -------------------------
--    Art Director sets a scene_tag; if a brand background already exists for that
--    tag we reuse it (cost ≈ $0) instead of re-generating. Fresh generations are
--    inserted back here so the Library grows on its own.
CREATE TABLE IF NOT EXISTS public.thumbnail_backgrounds (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    scene_tag TEXT NOT NULL,            -- e.g. "calculus-chalkboard", "statistics-graphs"
    prompt TEXT,                        -- the image prompt that produced it (for audit/regen)
    public_url TEXT NOT NULL,
    storage_path TEXT,
    palette JSONB,                      -- dominant colors, for compositor tinting if needed
    is_brand BOOLEAN DEFAULT FALSE,     -- curated brand backgrounds get priority on reuse
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS thumbnail_backgrounds_scene_tag_idx
    ON public.thumbnail_backgrounds (scene_tag);

ALTER TABLE public.thumbnail_backgrounds ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users manage the Library; the service-role worker bypasses RLS.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'thumbnail_backgrounds'
          AND policyname = 'Allow authenticated full access thumbnail_backgrounds'
    ) THEN
        CREATE POLICY "Allow authenticated full access thumbnail_backgrounds"
            ON public.thumbnail_backgrounds FOR ALL TO authenticated
            USING (true) WITH CHECK (true);
    END IF;
END $$;
