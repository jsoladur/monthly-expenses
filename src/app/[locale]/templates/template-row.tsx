"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/icon-button";
import { Pencil, CircleOff, RotateCcw, Check, X } from "lucide-react";
import { AmountInput } from "@/components/amount-input";
import { formatMoney } from "@/i18n/format";
import {
  deactivateTemplateAction,
  reactivateTemplateAction,
  updateTemplateAction,
} from "@/actions/templates";
import type { CategoryOption, TemplateRowData } from "./templates-screen";

// ============================================================================
// Template row (UC-05).
//
// One row per template. Three modes:
//   - default: shows name + category + amount + (Deactivate | Reactivate) +
//     Edit button
//   - editing: shows the same fields as the add form + Save + Cancel
//   - reacting: while the server action is in flight, the buttons disable
//
// All mutations go through server actions invoked via `formAction`. We use
// `useTransition` so the form submits without a hard navigation and the
// UI shows pending state.
//
// Inactive rows render with reduced opacity + an "Inactive" badge so users
// can scan the catalog and re-enable old entries without confusing them
// with active ones (PRD §6.2, §6.3).
// ============================================================================

export function TemplateRow({
  template,
  currency,
  expenseCategories,
}: {
  template: TemplateRowData;
  currency: string;
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("templates");
  const tv = useTranslations("validation");
  const [isEditing, setIsEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftAmount, setDraftAmount] = useState(centsToInputString(template.amountCents));

  const handleDeactivate = () => {
    setError(null);
    startTransition(async () => {
      const result = await deactivateTemplateAction({ id: template.id });
      if (!result.ok) {
        setError(mapError(result.error, tv));
      }
    });
  };

  const handleReactivate = () => {
    setError(null);
    startTransition(async () => {
      const result = await reactivateTemplateAction({ id: template.id });
      if (!result.ok) {
        setError(mapError(result.error, tv));
      }
    });
  };

  const handleSave = (formData: FormData) => {
    const payload = {
      id: template.id,
      categoryId: String(formData.get("categoryId") ?? ""),
      name: String(formData.get("name") ?? "").trim(),
      observations: readObservations(formData),
      amount: draftAmount.trim(),
      kind: template.kind,
    };
    setError(null);
    startTransition(async () => {
      const result = await updateTemplateAction(payload);
      if (result.ok) {
        setIsEditing(false);
      } else {
        setError(mapError(result.error, tv));
      }
    });
  };

  if (isEditing) {
    return (
      <li className="bg-card flex flex-col gap-2 rounded-md border p-3">
        <form action={handleSave} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-stretch gap-2">
            <label htmlFor={`edit-${template.id}-category`} className="sr-only">
              {t("category")}
            </label>
            <select
              id={`edit-${template.id}-category`}
              name="categoryId"
              required
              defaultValue={template.categoryId}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-0 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
            >
              {expenseCategories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <label htmlFor={`edit-${template.id}-name`} className="sr-only">
              {t("name")}
            </label>
            <input
              id={`edit-${template.id}-name`}
              name="name"
              type="text"
              autoComplete="off"
              defaultValue={template.name}
              required
              maxLength={80}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-0 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
            />
          </div>
          <label htmlFor={`edit-${template.id}-observations`} className="sr-only">
            {t("observations")}
          </label>
          <input
            id={`edit-${template.id}-observations`}
            name="observations"
            type="text"
            autoComplete="off"
            placeholder={t("observations")}
            maxLength={500}
            defaultValue={template.observations}
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          />
          <div className="flex flex-wrap items-stretch gap-2">
            <label htmlFor={`edit-${template.id}-amount`} className="sr-only">
              {t("amount")}
            </label>
            <div className="min-w-0 flex-1">
              <AmountInput
                value={draftAmount}
                onChange={setDraftAmount}
                ariaLabel={t("amount")}
                inputClassName="h-9"
                placeholder="1234.56"
              />
            </div>
            <IconButton
              icon={<Check className="size-4" />}
              label={t("actions.save")}
              disabled={pending}
              type="submit"
            />
            <IconButton
              icon={<X className="size-4" />}
              label={t("actions.cancel")}
              disabled={pending}
              onClick={() => {
                setIsEditing(false);
                setError(null);
                setDraftAmount(centsToInputString(template.amountCents));
              }}
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
        </form>
      </li>
    );
  }

  return (
    <li
      className={
        "bg-card flex items-center gap-2 rounded-md border p-3 " +
        (template.active ? "" : "opacity-60")
      }
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{template.name}</span>
        <span className="text-muted-foreground truncate text-xs">
          {template.categoryName} · {formatMoney(template.amountCents, currency)}
        </span>
        {template.observations && (
          <span className="text-muted-foreground truncate text-xs italic">
            {template.observations}
          </span>
        )}
      </div>
      {!template.active && (
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
          {t("inactive")}
        </span>
      )}
      <IconButton
        icon={<Pencil className="size-4" />}
        label={t("actions.edit")}
        disabled={pending}
        onClick={() => {
          setIsEditing(true);
          setError(null);
          setDraftAmount(centsToInputString(template.amountCents));
        }}
      />
      {template.active ? (
        <IconButton
          icon={<CircleOff className="size-4" />}
          label={t("actions.deactivate")}
          disabled={pending}
          onClick={handleDeactivate}
        />
      ) : (
        <IconButton
          icon={<RotateCcw className="size-4" />}
          label={t("actions.reactivate")}
          disabled={pending}
          onClick={handleReactivate}
        />
      )}
      {error && (
        <p role="alert" className="text-destructive basis-full text-xs">
          {error}
        </p>
      )}
    </li>
  );
}

function mapError(
  error:
    | "incomeCategory"
    | "inactiveCategory"
    | "notFound"
    | "alreadyInactive"
    | "alreadyActive"
    | "amountFormat"
    | "validation",
  tv: ReturnType<typeof useTranslations<"validation">>,
): string {
  switch (error) {
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
      // UI already enforces this; if we hit it, the row state changed
      // between render and click. The next revalidate drops the stale row.
      return "";
  }
}

function readObservations(formData: FormData): string | undefined {
  const value = formData.get("observations");
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// Integer cents → wire string (`"-20.00"`, `"150.00"`). Mirror of the
// serializer in the RSC; reused on the client so the input always starts
// in a valid state.
function centsToInputString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}
