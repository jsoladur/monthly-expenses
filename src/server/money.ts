// ============================================================================
// Money — integer-cents arithmetic (ADR-5, ARCH §8, PRD §7).
//
// DB column:   numeric(14,2) — comes back from PostgreSQL as a STRING.
// Wire format: "1234.56" / "-20.00"  (PRD C9 dot-decimal, 2 places).
// Domain code: integer cents only — never `number` arithmetic on amounts.
//
// All sums (potential savings, overspend baselines) use sumCents() which
// returns a safe bigint-capable integer. Negatives are first-class.
// ============================================================================

const AMOUNT_RE = /^-?\d{1,12}\.\d{2}$/;

export class AmountFormatError extends Error {
  constructor(input: unknown) {
    super(`Invalid amount format: ${JSON.stringify(input)} (expected "1234.56")`);
    this.name = "AmountFormatError";
  }
}

export function parseAmount(input: string): number {
  if (typeof input !== "string" || !AMOUNT_RE.test(input)) {
    throw new AmountFormatError(input);
  }
  const negative = input.startsWith("-");
  const digits = negative ? input.slice(1) : input;
  const [whole, frac] = digits.split(".") as [string, string];
  const cents = BigInt(whole) * 100n + BigInt(frac);
  const signed = negative ? -cents : cents;
  // Safe to narrow to number for our 14-digit numeric(14,2) range:
  // 9_999_999_999_999.99 → 999_999_999_999_999n. The signed value is at most
  // ~10^15, well under Number.MAX_SAFE_INTEGER (2^53 - 1 ≈ 9e15).
  return Number(signed);
}

export function formatCents(cents: number): string {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new TypeError(`formatCents requires an integer, received ${cents}`);
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}

export function sumCents(values: ReadonlyArray<number>): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isInteger(v)) {
      throw new TypeError(`sumCents: non-integer cents value ${v}`);
    }
    total += v;
  }
  return total;
}

export function negateCents(cents: number): number {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`negateCents: non-integer cents value ${cents}`);
  }
  return -cents;
}

/**
 * Integer division with half-up rounding (ties away from zero).
 * Used for 1-decimal percents derived from integer cents (UC-15 / ARCH §8).
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError("roundHalfUpDiv: division by zero");
  }
  if (denominator < 0n) {
    return roundHalfUpDiv(-numerator, -denominator);
  }
  if (numerator >= 0n) {
    return (numerator + denominator / 2n) / denominator;
  }
  return -(((-numerator) + denominator / 2n) / denominator);
}

/**
 * `(current / prior − 1)` as percent tenths (25.0% → 250).
 * Half-up. Returns `null` when `prior === 0`.
 */
export function ratioChangeToPercentTenths(
  currentCents: number,
  priorCents: number,
): number | null {
  if (!Number.isInteger(currentCents) || !Number.isInteger(priorCents)) {
    throw new TypeError("ratioChangeToPercentTenths requires integer cents");
  }
  if (priorCents === 0) return null;
  const n = BigInt(currentCents - priorCents) * 1000n;
  const d = BigInt(priorCents);
  return Number(roundHalfUpDiv(n, d));
}

/**
 * `(end / start)^(1/years) − 1` as percent tenths.
 * Integer nth-root of a scaled cents ratio — never `Math.pow` on euro floats.
 * Returns `null` when `startCents === 0` or `years < 1`.
 */
export function cagrPercentTenths(
  startCents: number,
  endCents: number,
  years: number,
): number | null {
  if (
    !Number.isInteger(startCents) ||
    !Number.isInteger(endCents) ||
    !Number.isInteger(years)
  ) {
    throw new TypeError("cagrPercentTenths requires integer cents and years");
  }
  if (startCents === 0 || years < 1) return null;
  if (years === 1) return ratioChangeToPercentTenths(endCents, startCents);

  const scale = 1_000_000_000_000n; // 1e12 fixed-point
  let scaleN = 1n;
  for (let i = 0; i < years; i++) scaleN *= scale;
  const radicand = (BigInt(endCents) * scaleN) / BigInt(startCents);
  const root = integerNthRoot(radicand, years);
  const delta = root - scale;
  return Number(roundHalfUpDiv(delta * 1000n, scale));
}

export function formatPercentTenths(tenths: number): string {
  if (!Number.isInteger(tenths)) {
    throw new TypeError(`formatPercentTenths requires an integer, received ${tenths}`);
  }
  const negative = tenths < 0;
  const abs = Math.abs(tenths);
  const whole = Math.floor(abs / 10);
  const frac = abs % 10;
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

function integerNthRoot(value: bigint, n: number): bigint {
  if (value < 0n) throw new RangeError("integerNthRoot of a negative");
  if (value === 0n) return 0n;
  if (n === 1) return value;
  const nBig = BigInt(n);
  let x = 1n << BigInt(Math.ceil(Number(bitLength(value)) / n));
  if (x === 0n) x = 1n;
  for (let i = 0; i < 64; i++) {
    const xPow = powBig(x, n - 1);
    if (xPow === 0n) break;
    const next = ((nBig - 1n) * x + value / xPow) / nBig;
    if (next === x || next === x + 1n || next === x - 1n) {
      x = next < 1n ? 1n : next;
      break;
    }
    x = next < 1n ? 1n : next;
  }
  while (powBig(x + 1n, n) <= value) x += 1n;
  while (x > 0n && powBig(x, n) > value) x -= 1n;
  return x;
}

function powBig(base: bigint, exp: number): bigint {
  let result = 1n;
  for (let i = 0; i < exp; i++) result *= base;
  return result;
}

function bitLength(value: bigint): bigint {
  let n = value;
  let bits = 0n;
  while (n > 0n) {
    n >>= 1n;
    bits += 1n;
  }
  return bits;
}

export const AMOUNT_PATTERN = AMOUNT_RE.source;
