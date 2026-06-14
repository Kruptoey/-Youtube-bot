import { ImageResponse } from 'next/og';
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = 'edge';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');
    const overrideTitle = searchParams.get('title');

    let titleText = overrideTitle || 'YouTube\nAutomation';
    
    if (videoId) {
      const { data: video } = await supabase.from('videos').select('generated_thumbnail_text').eq('id', videoId).single();
      if (video?.generated_thumbnail_text) {
        titleText = video.generated_thumbnail_text;
      }
    }

    // Fetch the latest Kruptoey asset
    const { data: assets } = await supabase.from('assets').select('public_url').order('created_at', { ascending: false }).limit(1);
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
            backgroundImage: 'linear-gradient(to bottom right, #3b82f6, #1d4ed8, #1e3a8a)', // Blue premium gradient
            padding: '80px',
            fontFamily: 'sans-serif',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* Left Side: Text */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: kruptoeyImageUrl ? '60%' : '100%',
              zIndex: 10,
            }}
          >
            <h1
              style={{
                fontSize: '110px',
                fontWeight: 900,
                color: 'white',
                lineHeight: 1.1,
                whiteSpace: 'pre-wrap',
                textShadow: '0 10px 20px rgba(0,0,0,0.8)',
              }}
            >
              {titleText}
            </h1>
          </div>

          {/* Right Side: Kruptoey Image */}
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
              <img
                src={kruptoeyImageUrl}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>
          )}
          
          <div
            style={{
              position: 'absolute',
              bottom: '40px',
              left: '80px',
              display: 'flex',
              alignItems: 'center',
              zIndex: 20,
            }}
          >
            <span
              style={{
                fontSize: '48px',
                fontWeight: 'bold',
                color: '#fbbf24', // Gold text
                textShadow: '0 4px 10px rgba(0,0,0,0.5)',
              }}
            >
              EazyCal
            </span>
          </div>
        </div>
      ),
      {
        width: 1280,
        height: 720,
      }
    );
  } catch (e: any) {
    return new Response(`Failed to generate image`, {
      status: 500,
    });
  }
}
