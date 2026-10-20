import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Revisiting a page within 60s (e.g. Customer stage tabs) reuses the client cache instead of refetching.
    staleTimes: { dynamic: 60 },
    // A reply can carry a 5 MB image; the default 1 MB would refuse it before CREOMS can say why.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
