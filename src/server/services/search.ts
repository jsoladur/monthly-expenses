import "server-only";
import { parseAmount } from "@/server/money";
import { searchActualsByText } from "@/server/repositories/search";
import { sanitizeSearchTerm } from "@/server/search/sanitize";
import type { SearchActualHit, SearchActualsResult } from "@/server/search/types";

export type { SearchActualHit, SearchActualsResult };

export async function searchActuals(
  userId: string,
  rawQuery: string | null | undefined,
): Promise<SearchActualsResult> {
  const raw = rawQuery ?? "";
  if (raw.trim() === "") {
    return { status: "idle" };
  }
  const term = sanitizeSearchTerm(raw);
  if (term === null) {
    return { status: "tooShort" };
  }
  const rows = await searchActualsByText(userId, term);
  const hits = rows.slice(0, 100).map(toHit);
  if (hits.length === 0) {
    return { status: "empty", query: raw };
  }
  return {
    status: "ok",
    query: raw,
    hits,
    truncated: rows.length > 100,
  };
}

function toHit(row: {
  id: string;
  monthId: string;
  year: number;
  month: number;
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  name: string;
  observations: string | null;
  amount: string;
}): SearchActualHit {
  return {
    id: row.id,
    monthId: row.monthId,
    year: row.year,
    month: row.month,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryActive: row.categoryActive,
    name: row.name,
    observations: row.observations,
    amountCents: parseAmount(row.amount),
  };
}
