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

export const AMOUNT_PATTERN = AMOUNT_RE.source;
