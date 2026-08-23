import { z } from "zod";
import { AMOUNT_PATTERN } from "./money";

// ============================================================================
// Shared Zod validators
//
// Amounts cross the wire as STRINGS matching `^-?\d{1,12}\.\d{2}$`:
//  - Dot decimal in both en/es locales (PRD C9, PRD §11).
//  - At most 12 integer digits, exactly 2 fractional digits.
//  - Negatives allowed (PRD §7.6).
// On the server we coerce via parseAmount() to integer cents before any
// arithmetic (ADR-5, ARCH §8).
// ============================================================================

export const amountSchema = z
  .string()
  .regex(
    new RegExp(`^${AMOUNT_PATTERN}$`),
    "Amount must be a number with exactly 2 decimals, e.g. '1234.56' or '-20.00'",
  );

export const nonEmptyStringSchema = z.string().trim().min(1);

export const uuidSchema = z.uuid();

export const yearSchema = z
  .number()
  .int()
  .min(1970)
  .max(9999);

export const monthSchema = z
  .number()
  .int()
  .min(1)
  .max(12);

export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code");

export type Amount = z.infer<typeof amountSchema>;
