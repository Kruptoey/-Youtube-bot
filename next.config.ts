import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // youtube-dl-exec locates its bundled yt-dlp binary via __dirname. When Next.js
  // bundles it into the Route Handler, __dirname is rewritten to a virtual "\ROOT\"
  // path that doesn't exist on disk, causing an ENOENT spawn error. Opting it out of
  // server bundling makes Next.js use native require() so __dirname resolves to the
  // real node_modules path and the binary is found.
  serverExternalPackages: ["youtube-dl-exec", "ffmpeg-static"],
};

export default nextConfig;
