import { ImageResponse } from 'next/og';
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = 'edge';

// ── Thai font loading ────────────────────────────────────────────────────────
// Satori (next/og) needs an embedded font to render glyphs; the bundled default
// has no Thai coverage. We fetch Kanit (a heavy, high-CTR Thai display face) once
// per runtime and memoize it. If the fetch fails we render without it rather than
// crash — Latin still works and the pipeline degrades gracefully.
type LoadedFont = { name: string; data: ArrayBuffer; weight: 700 | 800; style: 'normal' };
let fontPromise: Promise<LoadedFont[]> | null = null;

function loadFonts(): Promise<LoadedFont[]> {
  if (!fontPromise) {
    fontPromise = (async () => {
      // NOTE: the @main ref is required — the unpinned gh path 404s on jsdelivr.
      const sources: Array<[string, 700 | 800]> = [
        ['https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/kanit/Kanit-ExtraBold.ttf', 800],
        ['https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/kanit/Kanit-Bold.ttf', 700],
      ];
      const fonts: LoadedFont[] = [];
      for (const [url, weight] of sources) {
        try {
          const res = await fetch(url, { cache: 'force-cache' });
          if (res.ok) fonts.push({ name: 'Kanit', data: await res.arrayBuffer(), weight, style: 'normal' });
        } catch {
          /* ignore — degrade to default font */
        }
      }
      return fonts;
    })();
  }
  return fontPromise;
}

// Build a thick text outline from stacked text-shadows (Satori has no text-stroke).
// 8 directions at two radii give a clean, solid edge; a soft drop shadow adds depth.
function outline(color: string, w = 4): string {
  const dirs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const shadows: string[] = [];
  for (const r of [w, w / 2]) {
    for (const [dx, dy] of dirs) {
      shadows.push(`${(dx * r).toFixed(1)}px ${(dy * r).toFixed(1)}px 0 ${color}`);
    }
  }
  shadows.push('0 8px 12px rgba(0,0,0,0.55)');
  return shadows.join(', ');
}

type TextLayer = { th: string; role: 'headline' | 'accent' | 'sub'; fill: string; stroke: string };

const ROLE_STYLE: Record<TextLayer['role'], { fontSize: number; weight: 700 | 800; outline: number }> = {
  headline: { fontSize: 104, weight: 800, outline: 5 },
  accent: { fontSize: 88, weight: 800, outline: 5 },
  sub: { fontSize: 46, weight: 700, outline: 3 },
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');
    const overrideTitle = searchParams.get('title');

    let sceneUrl: string | null = null;
    let textLayers: TextLayer[] = [];
    let layout: 'subject-left' | 'subject-right' = 'subject-left';
    let fallbackText = overrideTitle || 'YouTube\nAutomation';

    if (videoId) {
      const { data: video } = await supabase
        .from('videos')
        .select('generated_thumbnail_text, generated_thumbnail_scene_url, thumbnail_brief')
        .eq('id', videoId)
        .single();

      if (video?.generated_thumbnail_text) fallbackText = video.generated_thumbnail_text;
      if (video?.generated_thumbnail_scene_url) sceneUrl = video.generated_thumbnail_scene_url;

      const brief = video?.thumbnail_brief as
        | { text_layers?: TextLayer[]; layout?: 'subject-left' | 'subject-right' }
        | null;
      if (brief?.text_layers?.length) textLayers = brief.text_layers;
      if (brief?.layout) layout = brief.layout;
    }

    const fonts = await loadFonts();
    const fontFamily = fonts.length ? 'Kanit, sans-serif' : 'sans-serif';

    // ── RICH PATH: AI scene present → composite scene + deterministic Thai text ──
    if (sceneUrl) {
      // Subject lives on `layout` side; text goes on the opposite side.
      const textOnLeft = layout === 'subject-right';
      const layers: TextLayer[] = textLayers.length
        ? textLayers
        : [{ th: fallbackText, role: 'headline', fill: '#FFD400', stroke: '#0A0A0A' }];

      return new ImageResponse(
        (
          <div style={{ display: 'flex', width: '100%', height: '100%', position: 'relative', fontFamily }}>
            <img
              src={sceneUrl}
              alt=""
              width={1280}
              height={720}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Text column on the clean side */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                [textOnLeft ? 'left' : 'right']: 0,
                width: '58%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: textOnLeft ? 'flex-start' : 'flex-end',
                textAlign: textOnLeft ? 'left' : 'right',
                padding: '64px',
                gap: '8px',
              }}
            >
              {layers.map((l, i) => {
                const s = ROLE_STYLE[l.role] ?? ROLE_STYLE.headline;
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      fontSize: s.fontSize,
                      fontWeight: s.weight,
                      color: l.fill,
                      lineHeight: 1.05,
                      letterSpacing: '-1px',
                      textShadow: outline(l.stroke, s.outline),
                      maxWidth: '100%',
                    }}
                  >
                    {l.th}
                  </div>
                );
              })}
            </div>
            {/* Brand logo */}
            <div
              style={{
                position: 'absolute',
                bottom: 36,
                right: 44,
                display: 'flex',
                fontSize: 44,
                fontWeight: 800,
                color: '#FFD400',
                textShadow: outline('#0A0A0A', 3),
              }}
            >
              Eazy Cal
            </div>
          </div>
        ),
        { width: 1280, height: 720, fonts: fonts.length ? fonts : undefined }
      );
    }

    // ── FALLBACK PATH: legacy template (no AI scene yet / generation degraded) ──
    const { data: assets } = await supabase
      .from('assets')
      .select('public_url')
      .order('created_at', { ascending: false })
      .limit(1);
    const kruptoeyImageUrl = assets && assets.length > 0 ? assets[0].public_url : null;

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#111827',
            backgroundImage: 'linear-gradient(to bottom right, #3b82f6, #1d4ed8, #1e3a8a)',
            padding: '80px',
            fontFamily,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', width: kruptoeyImageUrl ? '60%' : '100%', zIndex: 10 }}>
            <h1
              style={{
                fontSize: '110px',
                fontWeight: 800,
                color: 'white',
                lineHeight: 1.1,
                whiteSpace: 'pre-wrap',
                textShadow: outline('#0A0A0A', 4),
              }}
            >
              {fallbackText}
            </h1>
          </div>

          {kruptoeyImageUrl && (
            <div
              style={{
                display: 'flex',
                width: '45%',
                height: '120%',
                position: 'absolute',
                right: '-5%',
                bottom: '-10%',
                alignItems: 'flex-end',
                justifyContent: 'flex-end',
              }}
            >
              <img src={kruptoeyImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          )}

          <div style={{ position: 'absolute', bottom: '40px', left: '80px', display: 'flex', alignItems: 'center', zIndex: 20 }}>
            <span style={{ fontSize: '48px', fontWeight: 800, color: '#fbbf24', textShadow: outline('#0A0A0A', 3) }}>
              Eazy Cal
            </span>
          </div>
        </div>
      ),
      { width: 1280, height: 720, fonts: fonts.length ? fonts : undefined }
    );
  } catch {
    return new Response(`Failed to generate image`, { status: 500 });
  }
}
