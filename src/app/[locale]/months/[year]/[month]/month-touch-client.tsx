"use client";

import { useEffect } from "react";

// ============================================================================
// last_opened_month cookie — client-side write.
//
// Next.js 16 (ADR-6 era) forbids `cookies().set()` from RSC. The cookie is a
// pure UX hint (PRD §5.4: "UX convenience, never security boundary"), so we
// set it from the client after mount. The cookie value is the `{year}-{month}`
// string the RSC home page reads + re-validates against the DB (PRD UC-14).
//
// Server actions still set the cookie too (when the month is first created
// from the create form), so the resume flow works for both code paths.
// ============================================================================

export function MonthTouchClient({ year, month }: { year: number; month: number }) {
  useEffect(() => {
    const value = `${year}-${month}`;
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `last_opened_month=${encodeURIComponent(value)}; Path=/; Max-Age=${oneYear}; SameSite=Lax`;
  }, [year, month]);
  return null;
}
