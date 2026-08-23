import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't fail the build when the DB env vars are not set (e.g. CI image
  // build). The runtime check happens in src/server/db/client.ts and at
  // request time.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
