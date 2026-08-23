import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// ============================================================================
// Root layout (UC-01).
//
// Renders `<html>`/`<body>` because Next.js requires them at the top of the
// `app/` tree. All app routes live under `[locale]` (UC-01 screens 1 + 2);
// the `lang` attribute is updated inside `[locale]/layout.tsx` once UC-02
// wires next-intl. UC-01 keeps the root minimal so the slice has no font
// dependency and no assumptions about user-facing chrome.
// ============================================================================

export const metadata: Metadata = {
  title: "Monthly Expenses",
  description: "Personal monthly expense tracking.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
