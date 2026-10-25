import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for the Android APK (Capacitor serves `out/` from the
  // WebView — fully offline, zero server). `next dev` is unaffected.
  output: "export",
  images: {
    // no next/image server transforms in a static export
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
