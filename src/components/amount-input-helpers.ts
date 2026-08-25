import { AMOUNT_PATTERN } from "@/server/money";

// ============================================================================
// Amount input validation (UC-02, PRD C9, PRD §11).
//
// `1234.56` is the only accepted format — dot decimal in BOTH locales.
// Exported separately so the component, the tests, and (later) the Zod
// schema all share one source of truth.
//
// `classify` returns three states so the UI can give appropriate feedback:
//   - "ok"         — the value matches the wire regex exactly
//   - "incomplete" — the user is still typing (e.g. `1234.5`); do NOT shout
//                    an error until they leave the field
//   - "invalid"    — the value can never become valid (e.g. `1234,56`,
//                    `1234.567`, `abc`); show the localized error message
// ============================================================================

const AMOUNT_RE = new RegExp(`^${AMOUNT_PATTERN}$`);
const INTEGER_RE = /^-?\d{1,12}$/;
const PARTIAL_RE = /^-?\d{0,12}(\.\d{0,2})?$/;

export type AmountValidity = "ok" | "incomplete" | "invalid";

export function classifyAmount(value: string, required: boolean): AmountValidity {
  if (value === "") return required ? "incomplete" : "ok";
  if (AMOUNT_RE.test(value)) return "ok";
  if (value.includes(",")) return "invalid";
  if (PARTIAL_RE.test(value)) return "incomplete";
  return "invalid";
}

export function normalizeAmount(value: string): string {
  if (value === "") return value;
  if (INTEGER_RE.test(value)) return `${value}.00`;
  if (/^-?\d{1,12}\.\d$/.test(value)) return `${value}0`;
  return value;
}
