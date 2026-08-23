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
    background_color: "#F6F8FB",
    theme_color: "#1B3A6B",
    icons: [
      {
        src: "/icons/android-icon-36x36.png",
        sizes: "36x36",
        type: "image/png",
      },
      {
        src: "/icons/android-icon-48x48.png",
        sizes: "48x48",
        type: "image/png",
      },
      {
        src: "/icons/android-icon-72x72.png",
        sizes: "72x72",
        type: "image/png",
      },
      {
        src: "/icons/android-icon-96x96.png",
        sizes: "96x96",
        type: "image/png",
      },
      {
        src: "/icons/android-icon-144x144.png",
        sizes: "144x144",
        type: "image/png",
      },
      {
        src: "/icons/android-icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/android-icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
