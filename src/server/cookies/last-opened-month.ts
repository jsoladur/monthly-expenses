// ============================================================================
// Cookie helpers (PRD §5.4, ARCH §7).
//
// Lives OUTSIDE `src/actions/months.ts` because Next.js's `"use server"`
// directive forbids non-async exports from that file — the LAST_OPENED_MONTH
// cookie name + the typed shape must be importable from RSC code.
//
// These helpers use `next/headers#cookies()` directly, which works in any
// server context (RSC + server actions). The "use server" boundary is only
// needed for the create-month ACTION that mutates via revalidatePath + form
// post — read/write cookies from RSC don't go through that boundary.
// ============================================================================

import "server-only";
import { cookies } from "next/headers";

export const LAST_OPENED_MONTH_COOKIE = "last_opened_month" as const;

export interface LastOpenedMonth {
  year: number;
  month: number;
}

export async function readLastOpenedMonthCookie(): Promise<LastOpenedMonth | null> {
  const store = await cookies();
  const raw = store.get(LAST_OPENED_MONTH_COOKIE)?.value;
  if (!raw) return null;
  const match = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (!match) return null;
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export async function setLastOpenedMonthCookie(
  year: number,
  monthValue: number,
): Promise<void> {
  const store = await cookies();
  store.set({
    name: LAST_OPENED_MONTH_COOKIE,
    value: `${year}-${monthValue}`,
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

// UC-27: forget the resume hint when it points at a month that no longer
// exists. Only clears when it matches, so deleting another month keeps it.
export async function clearLastOpenedMonthCookieIf(
  year: number,
  monthValue: number,
): Promise<void> {
  const current = await readLastOpenedMonthCookie();
  if (!current || current.year !== year || current.month !== monthValue) return;
  const store = await cookies();
  store.delete({ name: LAST_OPENED_MONTH_COOKIE, path: "/" });
}
