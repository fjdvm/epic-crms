import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Revisiting a page within 3 minutes reuses the client cache, so it shows instantly instead of
    // refetching. Server Actions that change data call revalidatePath, which clears this cache.
    staleTimes: { dynamic: 180, static: 180 },
    // A reply can carry a 5 MB image; the default 1 MB would refuse it before CREOMS can say why.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
