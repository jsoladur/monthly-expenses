// ============================================================================
// Fixed expense month schedule (UC-20, PRD C23 / §6.3).
//
// Pure helpers shared by the templates service (normalization before every
// write) and tests. `null` = every month. A stored schedule is the sorted,
// unique month-numbers 1-12 with 1..11 entries: "all 12" collapses to `null`
// and an empty schedule is rejected (use Deactivate instead).
// ============================================================================

export class EmptyScheduleError extends Error {
  readonly code = "empty_schedule" as const;
  constructor() {
    super("A month schedule needs at least one month");
    this.name = "EmptyScheduleError";
  }
}

export class InvalidScheduleError extends Error {
  readonly code = "invalid_schedule" as const;
  constructor() {
    super("Schedule months must be integers between 1 and 12");
    this.name = "InvalidScheduleError";
  }
}

export function normalizeMonths(months: readonly number[] | null | undefined): number[] | null {
  if (months === null || months === undefined) return null;
  for (const m of months) {
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      throw new InvalidScheduleError();
    }
  }
  const unique = Array.from(new Set(months)).sort((a, b) => a - b);
  if (unique.length === 0) throw new EmptyScheduleError();
  if (unique.length === 12) return null;
  return unique;
}

export function appliesToMonth(months: readonly number[] | null, month: number): boolean {
  return months === null || months.includes(month);
}
