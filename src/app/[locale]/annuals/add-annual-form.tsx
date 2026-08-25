"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createAnnualAction,
  type AnnualActionResult,
} from "@/actions/annuals";
import { Button } from "@/components/ui/button";
import type { CategoryOption } from "./annuals-screen";

export function AddAnnualForm({
  expenseCategories,
}: {
  currency: string;
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("annuals");
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
    <AddAnnualFormBody
      expenseCategories={expenseCategories}
      t={t}
      tv={tv}
    />
  );
}

function AddAnnualFormBody({
  expenseCategories,
  t,
  tv,
}: {
  expenseCategories: CategoryOption[];
  t: ReturnType<typeof useTranslations<"annuals">>;
  tv: ReturnType<typeof useTranslations<"validation">>;
}) {
  const [bumpOnSuccess, setBumpOnSuccess] = useState(0);
  const [isDirectDebit, setIsDirectDebit] = useState(false);

  const [state, formAction, pending] = useActionState<AnnualActionResult | null, FormData>(
    async (_prev, formData) => {
      const payload = {
        categoryId: String(formData.get("categoryId") ?? ""),
        name: String(formData.get("name") ?? "").trim(),
        observations: readObservations(formData),
        chargeMonth: Number(formData.get("chargeMonth") ?? 1),
        isDirectDebit,
      };
      const result = await createAnnualAction(payload);
      if (result.ok) {
        setBumpOnSuccess((k) => k + 1);
        setIsDirectDebit(false);
      }
      return result;
    },
    null,
  );

  const formKey = `add-${bumpOnSuccess}`;
  const errorMessage = errorToMessage(state, tv);

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-2">
      <div className="flex items-stretch gap-2">
        <label htmlFor="new-annual-category" className="sr-only">
          {t("category")}
        </label>
        <select
          id="new-annual-category"
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
        <label htmlFor="new-annual-name" className="sr-only">
          {t("name")}
        </label>
        <input
          id="new-annual-name"
          name="name"
          type="text"
          autoComplete="off"
          placeholder={t("actions.placeholder")}
          required
          maxLength={80}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        />
      </div>
      <label htmlFor="new-annual-observations" className="sr-only">
        {t("observations")}
      </label>
      <input
        id="new-annual-observations"
        name="observations"
        type="text"
        autoComplete="off"
        placeholder={t("observations")}
        maxLength={500}
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
      />
      <div className="flex items-stretch gap-2">
        <label htmlFor="new-annual-chargeMonth" className="sr-only">
          {t("chargeMonth")}
        </label>
        <select
          id="new-annual-chargeMonth"
          name="chargeMonth"
          required
          defaultValue={1}
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
            checked={isDirectDebit}
            onChange={(e) => setIsDirectDebit(e.target.checked)}
            className="size-4 rounded border-gray-300"
          />
          <span>{t("isDirectDebit")}</span>
        </label>
        <Button type="submit" disabled={pending} size="default">
          {t("actions.add")}
        </Button>
      </div>
      {errorMessage && (
        <p role="alert" className="text-destructive text-xs">
          {errorMessage}
        </p>
      )}
    </form>
  );
}

function readObservations(formData: FormData): string | undefined {
  const value = formData.get("observations");
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function errorToMessage(
  state: AnnualActionResult | null,
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
    case "invalidChargeMonth":
      return tv("monthInvalid");
    case "validation":
      return tv("required");
    case "alreadyInactive":
    case "alreadyActive":
      return null;
  }
}

function getMonthName(month: number): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return months[month - 1] ?? "";
}
