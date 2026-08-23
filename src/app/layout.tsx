import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { isAppLocale } from "@/i18n/format";
import { auth } from "@/auth";
import { getProfileSettings } from "@/server/services/settings";
import { ThemeProvider } from "@/components/theme-provider";
import { themeInitScript } from "@/lib/theme-init-script";
import type { ThemePreference } from "@/server/db/schema";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monthly Expenses",
  description: "Personal monthly expense tracking.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/icons/apple-icon-57x57.png", sizes: "57x57", type: "image/png" },
      { url: "/icons/apple-icon-60x60.png", sizes: "60x60", type: "image/png" },
      { url: "/icons/apple-icon-72x72.png", sizes: "72x72", type: "image/png" },
      { url: "/icons/apple-icon-76x76.png", sizes: "76x76", type: "image/png" },
      { url: "/icons/apple-icon-114x114.png", sizes: "114x114", type: "image/png" },
      { url: "/icons/apple-icon-120x120.png", sizes: "120x120", type: "image/png" },
      { url: "/icons/apple-icon-144x144.png", sizes: "144x144", type: "image/png" },
      { url: "/icons/apple-icon-152x152.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/apple-icon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  other: {
    "msapplication-TileColor": "#1B3A6B",
    "msapplication-TileImage": "/icons/ms-icon-144x144.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1B3A6B" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1526" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const headerStore = await headers();
  const headerLocale = headerStore.get("x-next-intl-locale");
  const lang = isAppLocale(headerLocale) ? headerLocale : "en";

  let theme: ThemePreference = "auto";
  try {
    const session = await auth();
    if (session?.user?.id) {
      const settings = await getProfileSettings(session.user.id);
      if (settings?.theme) {
        theme = settings.theme as ThemePreference;
      }
    }
  } catch {
    // Unauthenticated or DB unavailable — use default
  }

  return (
    <html lang={lang} className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Monthly Expenses" />
        <link rel="apple-touch-icon" href="/icons/apple-icon.png" />
        <link rel="apple-touch-icon-precomposed" href="/icons/apple-icon-precomposed.png" />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider initialPreference={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
