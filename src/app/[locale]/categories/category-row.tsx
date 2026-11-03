"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/icon-button";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { Pencil, CircleOff, RotateCcw, Check, X, PiggyBank } from "lucide-react";
import {
  deactivateCategoryAction,
  reactivateCategoryAction,
  renameCategoryAction,
  setCategorySavingsAction,
  type CategoryActionError,
} from "@/actions/categories";
import { cn } from "@/lib/utils";
import type { CategoryRowData } from "./categories-screen";

// ============================================================================
// Category row (UC-03).
//
// One row per category. Three modes:
//   - default: shows name + (Deactivate | Reactivate) + Rename button
//   - editing: shows text input + Save + Cancel
//   - reacting: while the server action is in flight, the buttons disable
//
// Expense rows also carry the savings switch (UC-24). It doubles as the
// badge: off = dashed piggy bank, on = green-tint "Savings" pill.
//
// All mutations go through server actions invoked via `formAction`. We use
// `useTransition` so the form submits without a hard navigation and the
// UI shows pending state.
//
// Inactive rows render with reduced opacity and a "Inactive" badge so
// users can scan the catalog and re-enable old categories without
// confusing them with active ones (PRD §6.2).
// ============================================================================

export function CategoryRow({
  category,
  kind,
}: {
  category: CategoryRowData;
  kind: "expense" | "income";
}) {
  const t = useTranslations("categories");
  const tv = useTranslations("validation");
  const [isEditing, setIsEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDeactivate = () => {
    setError(null);
    startTransition(async () => {
      const result = await deactivateCategoryAction({ id: category.id });
      if (!result.ok) {
        setError(mapError(result.error, tv));
      }
    });
  };

  const handleReactivate = () => {
    setError(null);
    startTransition(async () => {
      const result = await reactivateCategoryAction({ id: category.id });
      if (!result.ok) {
        setError(mapError(result.error, tv));
      }
    });
  };

  const handleSavings = () => {
    setError(null);
    startTransition(async () => {
      const result = await setCategorySavingsAction({
        id: category.id,
        countsAsSavings: !category.countsAsSavings,
      });
      if (!result.ok) {
        setError(mapError(result.error, tv));
      }
    });
  };

  const handleRename = (formData: FormData) => {
    const name = String(formData.get("name") ?? "").trim();
    setError(null);
    startTransition(async () => {
      const result = await renameCategoryAction({ id: category.id, name });
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
        <form action={handleRename} className="flex items-stretch gap-2">
          <label htmlFor={`rename-${category.id}`} className="sr-only">
            {t("actions.newName")}
          </label>
          <input
            id={`rename-${category.id}`}
            name="name"
            type="text"
            defaultValue={category.name}
            required
            maxLength={80}
            autoFocus
            autoComplete="off"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          />
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
            }}
          />
        </form>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </li>
    );
  }

  return (
    <li
      className={
        "bg-card flex items-center gap-2 rounded-md border p-3 " +
        (category.active ? "" : "opacity-60")
      }
    >
      <span className="flex-1 truncate text-sm">{category.name}</span>
      {!category.active && (
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
          {t("expense.inactive")}
        </span>
      )}
      {kind === "expense" && (
        <HoverTooltip
          label={t(category.countsAsSavings ? "savings.unmark" : "savings.mark")}
        >
          <button
            type="button"
            role="switch"
            aria-checked={category.countsAsSavings}
            aria-label={t("savings.toggle")}
            aria-describedby="savings-help"
            disabled={pending}
            onClick={handleSavings}
            data-testid="category-savings-switch"
            className={cn(
              "focus-visible:ring-ring/50 inline-flex h-8 min-w-8 cursor-pointer items-center justify-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
              category.countsAsSavings
                ? "border-success/40 bg-success/15 text-success-foreground"
                : "border-border text-muted-foreground hover:text-foreground border-dashed",
            )}
          >
            <PiggyBank className="size-4" aria-hidden />
            {category.countsAsSavings && <span>{t("savings.badge")}</span>}
          </button>
        </HoverTooltip>
      )}
      <IconButton
        icon={<Pencil className="size-4" />}
        label={t("actions.edit")}
        disabled={pending}
        onClick={() => setIsEditing(true)}
      />
      {category.active ? (
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
  error: CategoryActionError,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string {
  switch (error) {
    case "savingsOnIncomeCategory":
      return tv("savingsOnIncomeCategory");
    case "duplicate":
      return tv("duplicateCategoryName");
    case "notFound":
      return tv("categoryNotFound");
    case "validation":
      return tv("required");
    case "alreadyInactive":
    case "alreadyActive":
      // UI already enforces this; if we hit it, the row state changed
      // between render and click. The next revalidate drops the stale row.
      return "";
  }
}
