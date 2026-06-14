-- SQL Schema for EazyCal YouTube AI Automation (Supabase) - PHASE 3: Multi-Provider

-- 1. Create ai_personas table
CREATE TABLE IF NOT EXISTS public.ai_personas (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL, -- 'openai', 'anthropic', 'google'
    model TEXT NOT NULL,    -- 'gpt-4o', 'claude-3-5-sonnet-20240620', 'gemini-1.5-pro'
    system_prompt TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for ai_personas
ALTER TABLE public.ai_personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access ai_personas" ON public.ai_personas FOR ALL TO anon USING (true) WITH CHECK (true);

-- 2. Insert a Default Persona so existing code doesn't break
INSERT INTO public.ai_personas (name, provider, model, system_prompt)
VALUES (
    'Default SEO Expert',
    'google',
    'gemini-1.5-pro',
    'You are an expert YouTube SEO specialist. Analyze this transcript and generate metadata.'
) ON CONFLICT DO NOTHING;

-- 3. Update videos table
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.ai_personas(id) ON DELETE SET NULL;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS transcript TEXT;
