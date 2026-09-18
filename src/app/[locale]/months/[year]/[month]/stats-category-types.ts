export interface CategoryLine {
  id: string;
  name: string;
  amountCents: number;
  observations: string | null;
}

export interface StatsActualLine {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  amountCents: number;
  observations: string | null;
}

export interface StatsReservedLine {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  remainingCents: number;
  kind: "estimated" | "committed";
  observations: string | null;
}

export interface CategoryBreakdown {
  categoryId: string;
  name: string;
  value: number;
  actuals: CategoryLine[];
  estimated: CategoryLine[];
  committed: CategoryLine[];
}

export function buildCategoryBreakdowns(
  actuals: StatsActualLine[],
  reservedLines: StatsReservedLine[],
): CategoryBreakdown[] {
  const map = new Map<string, CategoryBreakdown>();
  const bucket = (categoryId: string, name: string) => {
    const existing = map.get(categoryId);
    if (existing) return existing;
    const created: CategoryBreakdown = {
      categoryId,
      name,
      value: 0,
      actuals: [],
      estimated: [],
      committed: [],
    };
    map.set(categoryId, created);
    return created;
  };

  for (const actual of actuals) {
    const row = bucket(actual.categoryId, actual.categoryName);
    row.name = actual.categoryName;
    row.value += actual.amountCents;
    row.actuals.push({
      id: actual.id,
      name: actual.name,
      amountCents: actual.amountCents,
      observations: actual.observations,
    });
  }
  for (const line of reservedLines) {
    const row = bucket(line.categoryId, line.categoryName);
    row.name = line.categoryName;
    row.value += line.remainingCents;
    const item: CategoryLine = {
      id: line.id,
      name: line.name,
      amountCents: line.remainingCents,
      observations: line.observations,
    };
    if (line.kind === "estimated") row.estimated.push(item);
    else row.committed.push(item);
  }

  for (const row of map.values()) {
    row.actuals.sort(byAmountDesc);
    row.estimated.sort(byAmountDesc);
    row.committed.sort(byAmountDesc);
  }

  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

function byAmountDesc(a: CategoryLine, b: CategoryLine) {
  return b.amountCents - a.amountCents;
}
