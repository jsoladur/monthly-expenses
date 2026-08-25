"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/icon-button";
import { Pencil, CircleOff, RotateCcw, Check, X } from "lucide-react";
import {
  deactivateAnnualAction,
  reactivateAnnualAction,
  updateAnnualAction,
} from "@/actions/annuals";
import type { AnnualRowData, CategoryOption } from "./annuals-screen";

export function AnnualRow({
  annual,
  expenseCategories,
}: {
  annual: AnnualRowData;
  currency: string;
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("annuals");
  const tv = useTranslations("validation");
  const [isEditing, setIsEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDeactivate = () => {
    setError(null);
    startTransition(async () => {
      const result = await deactivateAnnualAction({ id: annual.id });
      if (!result.ok) {
        setError(mapError(result.error, tv));
      }
    });
  };

  const handleReactivate = () => {
    setError(null);
    startTransition(async () => {
      const result = await reactivateAnnualAction({ id: annual.id });
      if (!result.ok) {
        setError(mapError(result.error, tv));
      }
    });
  };

  const handleSave = (formData: FormData) => {
    const payload = {
      id: annual.id,
      categoryId: String(formData.get("categoryId") ?? ""),
      name: String(formData.get("name") ?? "").trim(),
      observations: readObservations(formData),
      chargeMonth: Number(formData.get("chargeMonth") ?? 1),
      isDirectDebit: formData.get("isDirectDebit") === "on",
    };
    setError(null);
    startTransition(async () => {
      const result = await updateAnnualAction(payload);
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
          <div className="flex items-stretch gap-2">
            <label htmlFor={`edit-${annual.id}-category`} className="sr-only">
              {t("category")}
            </label>
            <select
              id={`edit-${annual.id}-category`}
              name="categoryId"
              required
              defaultValue={annual.categoryId}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
            >
              {expenseCategories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <label htmlFor={`edit-${annual.id}-name`} className="sr-only">
              {t("name")}
            </label>
            <input
              id={`edit-${annual.id}-name`}
              name="name"
              type="text"
              autoComplete="off"
              defaultValue={annual.name}
              required
              maxLength={80}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
            />
          </div>
          <label htmlFor={`edit-${annual.id}-observations`} className="sr-only">
            {t("observations")}
          </label>
          <input
            id={`edit-${annual.id}-observations`}
            name="observations"
            type="text"
            autoComplete="off"
            placeholder={t("observations")}
            maxLength={500}
            defaultValue={annual.observations}
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          />
          <div className="flex items-stretch gap-2">
            <label htmlFor={`edit-${annual.id}-chargeMonth`} className="sr-only">
              {t("chargeMonth")}
            </label>
            <select
              id={`edit-${annual.id}-chargeMonth`}
              name="chargeMonth"
              required
              defaultValue={annual.chargeMonth}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                <option key={month} value={month}>
                  {getMonthName(month)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-md border px-3 py-1 text-sm">
              <input
                type="checkbox"
                name="isDirectDebit"
                defaultChecked={annual.isDirectDebit}
                className="size-4 rounded border-gray-300"
              />
              <span>{t("isDirectDebit")}</span>
            </label>
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
        (annual.active ? "" : "opacity-60")
      }
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{annual.name}</span>
          {annual.isDirectDebit && (
            <span className="bg-sky-tint text-navy rounded-full px-2 py-0.5 text-xs">
              {t("isDirectDebit")}
            </span>
          )}
        </div>
        <span className="text-muted-foreground truncate text-xs">
          {annual.categoryName} · {getMonthName(annual.chargeMonth)}
        </span>
        {annual.observations && (
          <span className="text-muted-foreground truncate text-xs italic">
            {annual.observations}
          </span>
        )}
      </div>
      {!annual.active && (
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
        }}
      />
      {annual.active ? (
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
    | "invalidChargeMonth"
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
    case "invalidChargeMonth":
      return tv("monthInvalid");
    case "validation":
      return tv("required");
    case "alreadyInactive":
    case "alreadyActive":
      return "";
  }
}

function readObservations(formData: FormData): string | undefined {
  const value = formData.get("observations");
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function getMonthName(month: number): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return months[month - 1] ?? "";
}
