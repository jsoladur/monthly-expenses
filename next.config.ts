import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

// ============================================================================
// Next.js configuration.
//
// - `output: 'standalone'` — single deployable container (ADR-1, ARCH §1).
// - `withSerwist` — PWA service worker (UC-12). Dev runs use webpack so the
//   plugin can build the SW; production uses the same flag to keep the
//   standalone output self-contained.
// - `createNextIntlPlugin` — marks `src/i18n/request.ts` so the standalone
//   build's output-tracer includes it. Without this wrapper, the request
//   config (and therefore every server-side `getTranslations()` call) fails
//   at runtime with "Couldn't find next-intl config file".
// ============================================================================

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  // Dev runs use webpack so the plugin can build the service worker.
  disable: process.env.NODE_ENV !== "production",
});

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't fail the build when DB env vars are not set (CI image build).
  // Runtime check happens in src/server/db/client.ts.
  serverExternalPackages: ["postgres"],
};

export default withSerwist(withNextIntl(nextConfig));
