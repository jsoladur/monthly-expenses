"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  deactivateCategoryAction,
  reactivateCategoryAction,
  renameCategoryAction,
} from "@/actions/categories";
import type { CategoryRowData } from "./categories-screen";

// ============================================================================
// Category row (UC-03).
//
// One row per category. Three modes:
//   - default: shows name + (Deactivate | Reactivate) + Rename button
//   - editing: shows text input + Save + Cancel
//   - reacting: while the server action is in flight, the buttons disable
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
}: {
  category: CategoryRowData;
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
          <Button type="submit" disabled={pending} size="sm">
            {t("actions.save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setIsEditing(false);
              setError(null);
            }}
          >
            {t("actions.cancel")}
          </Button>
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setIsEditing(true)}
      >
        {t("actions.edit")}
      </Button>
      {category.active ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={handleDeactivate}
        >
          {t("actions.deactivate")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={handleReactivate}
        >
          {t("actions.reactivate")}
        </Button>
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
    | "duplicate"
    | "notFound"
    | "alreadyInactive"
    | "alreadyActive"
    | "validation",
  tv: ReturnType<typeof useTranslations<"validation">>,
): string {
  switch (error) {
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
