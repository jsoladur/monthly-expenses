export type SearchActualHit = {
  id: string;
  monthId: string;
  year: number;
  month: number;
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  name: string;
  observations: string | null;
  amountCents: number;
};

export type SearchActualsResult =
  | { status: "idle" }
  | { status: "tooShort" }
  | { status: "empty"; query: string }
  | { status: "ok"; query: string; hits: SearchActualHit[]; truncated: boolean };
