import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";

// ============================================================================
// Message-bundle parity (UC-02).
//
// Every user-facing string keyed in one locale MUST be keyed in the other.
// The two bundles must have the same set of leaf keys so a missing
// translation surfaces at build time, not at runtime. We walk both trees
// and compare the sorted leaf-key sets.
// ============================================================================

type JsonObject = { [key: string]: JsonObject | string };

function flatten(value: JsonObject, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      out.push(...flatten(v as JsonObject, next));
    } else {
      out.push(next);
    }
  }
  return out.sort();
}

describe("i18n messages", () => {
  it("have identical leaf keys across en and es", () => {
    const enKeys = flatten(en as JsonObject);
    const esKeys = flatten(es as JsonObject);
    expect(esKeys).toEqual(enKeys);
  });

  it("do not have empty string values (PR review hint)", () => {
    for (const locale of ["en", "es"] as const) {
      const tree = (locale === "en" ? en : es) as JsonObject;
      const empties: string[] = [];
      const visit = (value: JsonObject, prefix = "") => {
        for (const [k, v] of Object.entries(value)) {
          const next = prefix ? `${prefix}.${k}` : k;
          if (v !== null && typeof v === "object") {
            visit(v as JsonObject, next);
          } else if (typeof v === "string" && v.trim() === "") {
            empties.push(next);
          }
        }
      };
      visit(tree);
      expect(empties, `${locale} has empty copy`).toEqual([]);
    }
  });
});
