export type ReservedLineOrigin = "cloned" | "month_only";
export type ReservedLineKind = "committed" | "estimated";

export interface ReservedLineRowData {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  name: string;
  observations: string | null;
  remainingCents: number;
  originalCents: number;
  kind: ReservedLineKind;
  origin: ReservedLineOrigin;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface ReservedLineGroup {
  kind: ReservedLineKind;
  rows: ReservedLineRowData[];
}
