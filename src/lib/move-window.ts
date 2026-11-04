// ============================================================================
// Move-an-actual window (UC-26).
//
// Pure helpers shared by the RSC picker and the service gate so both apply
// the exact same rule. Months compare by `index = year * 12 + (month − 1)`.
//
// Allowed target T for a ticket in month S (T must already exist):
//   - Upcoming: any index(T) > index(S), across years, no upper bound.
//   - Previous: index(S) − 3 ≤ index(T) < index(S), across years.
//   - T = S is never allowed.
// ============================================================================

export type MoveMonthKey = { year: number; month: number };

export const MOVE_MAX_MONTHS_BACK = 3;

export function monthIndex(key: MoveMonthKey): number {
  return key.year * 12 + (key.month - 1);
}

export function isMoveTargetAllowed(
  source: MoveMonthKey,
  target: MoveMonthKey,
): boolean {
  const s = monthIndex(source);
  const t = monthIndex(target);
  if (t > s) return true;
  return t < s && t >= s - MOVE_MAX_MONTHS_BACK;
}

export interface MoveTargets<T extends MoveMonthKey> {
  /** Newest first, at most 3. */
  previous: T[];
  /** Oldest first. */
  upcoming: T[];
}

export function splitMoveTargets<T extends MoveMonthKey>(
  source: MoveMonthKey,
  months: readonly T[],
): MoveTargets<T> {
  const s = monthIndex(source);
  const allowed = months.filter((m) => isMoveTargetAllowed(source, m));
  const previous = allowed
    .filter((m) => monthIndex(m) < s)
    .sort((a, b) => monthIndex(b) - monthIndex(a));
  const upcoming = allowed
    .filter((m) => monthIndex(m) > s)
    .sort((a, b) => monthIndex(a) - monthIndex(b));
  return { previous, upcoming };
}

export function hasMoveTargets<T extends MoveMonthKey>(
  targets: MoveTargets<T>,
): boolean {
  return targets.previous.length + targets.upcoming.length > 0;
}
