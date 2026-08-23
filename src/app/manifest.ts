import type { MetadataRoute } from "next";

const APP_NAME = "Monthly Expenses";
const APP_DESCRIPTION = "Personal monthly expense tracking.";

export default function manifest(): MetadataRoute.Manifest {
  const startUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://expenses.jmsola.dev";

  return {
    name: APP_NAME,
    short_name: "Expenses",
    description: APP_DESCRIPTION,
    start_url: startUrl,
    scope: startUrl,
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
