import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Revisiting a page within 60s (e.g. Customer stage tabs) reuses the client cache instead of refetching.
    staleTimes: { dynamic: 60 },
  },
};

export default nextConfig;
