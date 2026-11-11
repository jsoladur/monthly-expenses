// ============================================================================
// Last payment month of a committed fixed expense (UC-29, PRD C29 / §6.3).
//
// Pure helpers shared by the templates service (validation before every
// write), the UI and tests. `null` = no last payment month. Months compare
// by `index = year * 12 + (month − 1)`, the same rule UC-26 uses.
//
// For a month P being created and a last payment month E:
//   - P <= E → the fixed expense is copied into P (E itself is the last copy).
//   - P >= E → the fixed expense is deactivated (so a skipped E still ends it).
// ============================================================================

export type EndMonth = { year: number; month: number };

export const END_YEAR_MIN = 1970;
export const END_YEAR_MAX = 9999;

export class EndMonthOnEstimatedError extends Error {
  readonly code = "end_month_on_estimated" as const;
  constructor() {
    super("Only committed fixed expenses can have a last payment month");
    this.name = "EndMonthOnEstimatedError";
  }
}

export class InvalidEndMonthError extends Error {
  readonly code = "invalid_end_month" as const;
  constructor() {
    super("Last payment month must be a month 1-12 of a year 1970-9999");
    this.name = "InvalidEndMonthError";
  }
}

export function normalizeEndMonth(
  kind: "committed" | "estimated",
  end: EndMonth | null | undefined,
): EndMonth | null {
  if (end === null || end === undefined) return null;
  if (kind !== "committed") throw new EndMonthOnEstimatedError();
  if (!isValidEndMonth(end)) throw new InvalidEndMonthError();
  return { year: end.year, month: end.month };
}

export function isValidEndMonth(end: EndMonth): boolean {
  return (
    Number.isInteger(end.year) &&
    Number.isInteger(end.month) &&
    end.month >= 1 &&
    end.month <= 12 &&
    end.year >= END_YEAR_MIN &&
    end.year <= END_YEAR_MAX
  );
}

function index(period: EndMonth): number {
  return period.year * 12 + (period.month - 1);
}

export function isCopiedInto(end: EndMonth | null, period: EndMonth): boolean {
  return end === null || index(period) <= index(end);
}

export function hasEndedBy(end: EndMonth | null, period: EndMonth): boolean {
  return end !== null && index(period) >= index(end);
}
