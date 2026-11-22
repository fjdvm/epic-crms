import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the container image (see Dockerfile).
  output: "standalone",
  // The Proof reader runs Tesseract on the server; keep its worker and WebAssembly files as real files.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  // The worker loads its WebAssembly core with a computed require, which the file tracer cannot see.
  outputFileTracingIncludes: { "/api/cron/proof-reader": ["./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*", "./node_modules/regenerator-runtime/**/*", "./node_modules/is-url/**/*", "./node_modules/bmp-js/**/*", "./node_modules/idb-keyval/**/*", "./node_modules/wasm-feature-detect/**/*", "./node_modules/zlibjs/**/*", "./node_modules/node-fetch/**/*"] },
  // The two old Management tabs became one screen; keep their bookmarks working.
  async redirects() {
    return [
      { source: "/management/payment-management", destination: "/management/commerce-settings", permanent: true },
      { source: "/management/delivery-management", destination: "/management/commerce-settings", permanent: true },
    ];
  },
  experimental: {
    // Revisiting a page within 3 minutes reuses the client cache, so it shows instantly instead of
    // refetching. Server Actions that change data call revalidatePath, which clears this cache.
    staleTimes: { dynamic: 180, static: 180 },
    // A reply can carry a 5 MB image; the default 1 MB would refuse it before CREOMS can say why.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
