"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createTemplateAction,
  type TemplateActionResult,
} from "@/actions/templates";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/amount-input";
import type { CategoryOption } from "./templates-screen";

// ============================================================================
// Add template form (UC-05).
//
// Uses React 19's `useActionState` so the form posts to the server action and
// the action's error code lands in component state. A successful submit
// increments a `formKey` so React remounts the form and the inputs clear.
//
// The category select only shows ACTIVE expense categories — income and
// soft-deleted categories are hidden at the source (the RSC passes only
// `listActiveCategoriesForPicker` results). The AmountInput enforces the
// wire format client-side; the server is the boundary.
// ============================================================================

type Kind = "committed" | "estimated";

export function AddTemplateForm({
  kind,
  currency,
  expenseCategories,
}: {
  kind: Kind;
  currency: string;
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("templates");
  const tv = useTranslations("validation");

  if (expenseCategories.length === 0) {
    return (
      <p
        role="status"
        className="bg-muted/40 border-border/40 rounded-md border px-3 py-2 text-xs leading-relaxed"
      >
        {tv("noActiveExpenseCategories")}
      </p>
    );
  }

  return (
    <AddTemplateFormBody
      kind={kind}
      currency={currency}
      expenseCategories={expenseCategories}
      t={t}
      tv={tv}
    />
  );
}

function AddTemplateFormBody({
  kind,
  currency,
  expenseCategories,
  t,
  tv,
}: {
  kind: Kind;
  currency: string;
  expenseCategories: CategoryOption[];
  t: ReturnType<typeof useTranslations<"templates">>;
  tv: ReturnType<typeof useTranslations<"validation">>;
}) {
  const [bumpOnSuccess, setBumpOnSuccess] = useState(0);
  const [draftAmount, setDraftAmount] = useState("");
  const boundAction = bindKind(createTemplateAction, kind);

  const [state, formAction, pending] = useActionState<TemplateActionResult | null, FormData>(
    async (_prev, formData) => {
      const payload = {
        categoryId: String(formData.get("categoryId") ?? ""),
        name: String(formData.get("name") ?? "").trim(),
        observations: readObservations(formData),
        amount: draftAmount.trim(),
        kind,
      };
      const result = await boundAction(payload);
      if (result.ok) {
        setBumpOnSuccess((k) => k + 1);
        setDraftAmount("");
      }
      return result;
    },
    null,
  );

  // formKey = kind + bumpOnSuccess → remounts on tab flip OR after a
  // successful add (so the category select resets to the first option and
  // the name input clears).
  const formKey = `${kind}-${bumpOnSuccess}`;
  const errorMessage = errorToMessage(state, tv);

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-2">
      <div className="flex items-stretch gap-2">
        <label htmlFor={`new-${kind}-category`} className="sr-only">
          {t("category")}
        </label>
        <select
          id={`new-${kind}-category`}
          name="categoryId"
          required
          defaultValue={expenseCategories[0]?.id ?? ""}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        >
          {expenseCategories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <label htmlFor={`new-${kind}-name`} className="sr-only">
          {t("name")}
        </label>
        <input
          id={`new-${kind}-name`}
          name="name"
          type="text"
          autoComplete="off"
          placeholder={t("actions.placeholder")}
          required
          maxLength={80}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        />
      </div>
      <label htmlFor={`new-${kind}-observations`} className="sr-only">
        {t("observations")}
      </label>
      <input
        id={`new-${kind}-observations`}
        name="observations"
        type="text"
        autoComplete="off"
        placeholder={t("observations")}
        maxLength={500}
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
      />
      <div className="flex items-stretch gap-2">
        <label htmlFor={`new-${kind}-amount`} className="sr-only">
          {t("amount")}
        </label>
        <div className="flex-1">
          <AmountInput
            value={draftAmount}
            onChange={setDraftAmount}
            id={`new-${kind}-amount`}
            name="amount-shim"
            ariaLabel={t("amount")}
            inputClassName="h-9"
            placeholder="1234.56"
          />
        </div>
        <Button type="submit" disabled={pending} size="default">
          {t("actions.add")}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {t("amount")} · {currency}
      </p>
      {errorMessage && (
        <p role="alert" className="text-destructive text-xs">
          {errorMessage}
        </p>
      )}
    </form>
  );
}

// Bind the kind argument so the form only ships the user-editable fields in
// the FormData; server actions accept a single serializable object — we
// wrap them so the add form stays simple.
function bindKind(
  action: (input: {
    categoryId: string;
    name: string;
    observations?: string;
    amount: string;
    kind: Kind;
  }) => Promise<TemplateActionResult>,
  kind: Kind,
): (input: {
  categoryId: string;
  name: string;
  observations?: string;
  amount: string;
}) => Promise<TemplateActionResult> {
  return (input) => action({ ...input, kind });
}

function readObservations(formData: FormData): string | undefined {
  const value = formData.get("observations");
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function errorToMessage(
  state: TemplateActionResult | null,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case "incomeCategory":
      return tv("incomeCategoryNotAllowed");
    case "inactiveCategory":
      return tv("categoryNotFound");
    case "notFound":
      return tv("categoryNotFound");
    case "amountFormat":
      return tv("amountFormat");
    case "validation":
      return tv("required");
    case "alreadyInactive":
    case "alreadyActive":
      return null;
  }
}
