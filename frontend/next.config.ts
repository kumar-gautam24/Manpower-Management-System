import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.onrender.com' },
    ],
  },
  output: 'standalone',
  reactCompiler: true,
};

export default nextConfig;
