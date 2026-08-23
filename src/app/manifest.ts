// ============================================================================
// PWA web manifest (ADR-7). Served at /manifest.webmanifest.
// Final icon set, theme colour, and install-prompt affordance land in UC-12.
// ============================================================================

import type { MetadataRoute } from "next";

const APP_NAME = "Monthly Expenses";
const APP_DESCRIPTION = "Personal monthly expense tracking.";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "Expenses",
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
