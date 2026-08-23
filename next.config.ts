import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  // Dev runs use webpack so the plugin can build the service worker.
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't fail the build when DB env vars are not set (CI image build).
  // Runtime check happens in src/server/db/client.ts.
  serverExternalPackages: ["postgres"],
};

export default withSerwist(nextConfig);
