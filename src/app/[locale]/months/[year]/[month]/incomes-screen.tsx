"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { AmountInput } from "@/components/amount-input";
import { centsToInputString, formatMoney } from "@/i18n/format";
import {
  addIncomeAction,
  deleteIncomeAction,
  editIncomeAction,
  type IncomeActionResult,
} from "@/actions/incomes";
import { Button } from "@/components/ui/button";

// ============================================================================
// Incomes screen (UC-07) — interactive part of the workspace's incomes block.
//
// Reads come from the RSC parent (`page.tsx`) which serializes each row's
// `amountCents` (integer, ADR-5 / ARCH §8) plus the category map. The screen
// is purely presentational + tab/form state; mutations happen through the
// `addIncomeAction` / `editIncomeAction` / `deleteIncomeAction` server actions
// which revalidate `/[locale]/months/<year>/<month>` on success.
//
// Historical incomes keep rendering even after their category is deactivated
// (PRD §6.5). The RSC passes the FULL category map (active + inactive) so the
// row can look up its category name; we render a muted note when the
// category is inactive.
// ============================================================================

export interface IncomeRowData {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  name: string;
  amountCents: number;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export function IncomesScreen({
  monthId,
  year,
  month,
  currency,
  initialIncomes,
  incomeCategories,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  initialIncomes: IncomeRowData[];
  incomeCategories: CategoryOption[];
}) {
  const t = useTranslations("incomes");

  return (
    <section className="flex flex-col gap-3">
      <AddIncomeForm
        monthId={monthId}
        year={year}
        month={month}
        currency={currency}
        incomeCategories={incomeCategories}
      />

      {initialIncomes.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {initialIncomes.map((row) => (
            <IncomeRow
              key={row.id}
              row={row}
              monthId={monthId}
              year={year}
              month={month}
              currency={currency}
              incomeCategories={incomeCategories}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------------

function AddIncomeForm({
  monthId,
  year,
  month,
  currency,
  incomeCategories,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  incomeCategories: CategoryOption[];
}) {
  const t = useTranslations("incomes");
  const tv = useTranslations("validation");

  if (incomeCategories.length === 0) {
    return (
      <p
        role="status"
        className="bg-muted/40 border-border/40 rounded-md border px-3 py-2 text-xs leading-relaxed"
      >
        {tv("noActiveIncomeCategories")}
      </p>
    );
  }

  return (
    <AddIncomeFormBody
      monthId={monthId}
      year={year}
      month={month}
      currency={currency}
      incomeCategories={incomeCategories}
      t={t}
      tv={tv}
    />
  );
}

function AddIncomeFormBody({
  monthId,
  year,
  month,
  currency,
  incomeCategories,
  t,
  tv,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  incomeCategories: CategoryOption[];
  t: ReturnType<typeof useTranslations<"incomes">>;
  tv: ReturnType<typeof useTranslations<"validation">>;
}) {
  const [bumpOnSuccess, setBumpOnSuccess] = useState(0);
  const [draftAmount, setDraftAmount] = useState("");
  const [state, formAction, pending] = useActionState<IncomeActionResult | null, FormData>(
    async (_prev, formData) => {
      const payload = {
        monthId,
        year,
        month,
        categoryId: String(formData.get("categoryId") ?? ""),
        name: String(formData.get("name") ?? "").trim(),
        amount: draftAmount.trim(),
      };
      const result = await addIncomeAction(payload);
      if (result.ok) {
        setBumpOnSuccess((k) => k + 1);
        setDraftAmount("");
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
        <label htmlFor="new-income-category" className="sr-only">
          {t("category")}
        </label>
        <select
          id="new-income-category"
          name="categoryId"
          required
          defaultValue={incomeCategories[0]?.id ?? ""}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        >
          {incomeCategories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <label htmlFor="new-income-name" className="sr-only">
          {t("name")}
        </label>
        <input
          id="new-income-name"
          name="name"
          type="text"
          autoComplete="off"
          placeholder={t("actions.placeholder")}
          required
          maxLength={80}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        />
      </div>
      <div className="flex items-stretch gap-2">
        <label htmlFor="new-income-amount" className="sr-only">
          {t("amount")}
        </label>
        <div className="flex-1">
          <AmountInput
            value={draftAmount}
            onChange={setDraftAmount}
            id="new-income-amount"
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
        <p role="alert" aria-live="polite" className="text-destructive text-xs">
          {errorMessage}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Row (read / edit / delete)
// ---------------------------------------------------------------------------

function IncomeRow({
  row,
  monthId,
  year,
  month,
  currency,
  incomeCategories,
}: {
  row: IncomeRowData;
  monthId: string;
  year: number;
  month: number;
  currency: string;
  incomeCategories: CategoryOption[];
}) {
  const t = useTranslations("incomes");
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditIncomeForm
        row={row}
        monthId={monthId}
        year={year}
        month={month}
        incomeCategories={incomeCategories}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return (
    <li className="bg-card text-card-foreground flex flex-col gap-1 rounded-md border px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-col">
          <span>{row.name}</span>
          <span className="text-muted-foreground text-xs">
            {row.categoryName}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums">
            {formatMoney(row.amountCents, currency)}
          </span>
          <RowActions
            rowId={row.id}
            monthId={monthId}
            year={year}
            month={month}
            onEdit={() => setEditing(true)}
          />
        </span>
      </div>
      {!row.categoryActive && (
        <p className="text-muted-foreground text-xs">
          {t("historicalInactiveNote")}
        </p>
      )}
    </li>
  );
}

function RowActions({
  rowId,
  monthId,
  year,
  month,
  onEdit,
}: {
  rowId: string;
  monthId: string;
  year: number;
  month: number;
  onEdit: () => void;
}) {
  const t = useTranslations("incomes");
  const [pending, setPending] = useState(false);
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        className="text-muted-foreground hover:text-foreground px-2 text-xs underline-offset-4 hover:underline"
      >
        {t("actions.edit")}
      </button>
      <form
        action={async () => {
          if (pending) return;
          if (!window.confirm(t("actions.confirmDelete"))) return;
          setPending(true);
          await deleteIncomeAction({ id: rowId, monthId, year, month });
          setPending(false);
        }}
      >
        <button
          type="submit"
          disabled={pending}
          className="text-muted-foreground hover:text-destructive px-2 text-xs underline-offset-4 hover:underline"
        >
          {t("actions.delete")}
        </button>
      </form>
    </span>
  );
}

function EditIncomeForm({
  row,
  monthId,
  year,
  month,
  incomeCategories,
  onCancel,
  onSaved,
}: {
  row: IncomeRowData;
  monthId: string;
  year: number;
  month: number;
  incomeCategories: CategoryOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("incomes");
  const tv = useTranslations("validation");
  const [draftAmount, setDraftAmount] = useState(centsToInputString(row.amountCents));

  const [state, formAction, pending] = useActionState<IncomeActionResult | null, FormData>(
    async (_prev, formData) => {
      const payload = {
        id: row.id,
        monthId,
        year,
        month,
        categoryId: String(formData.get("categoryId") ?? ""),
        name: String(formData.get("name") ?? "").trim(),
        amount: draftAmount.trim(),
      };
      const result = await editIncomeAction(payload);
      if (result.ok) {
        onSaved();
      }
      return result;
    },
    null,
  );

  const errorMessage = errorToMessage(state, tv);

  return (
    <li className="bg-card text-card-foreground flex flex-col gap-2 rounded-md border px-4 py-2 text-sm">
      <form action={formAction} className="flex flex-col gap-2">
        <div className="flex items-stretch gap-2">
          <label
            htmlFor={`edit-income-category-${row.id}`}
            className="sr-only"
          >
            {t("category")}
          </label>
          <select
            id={`edit-income-category-${row.id}`}
            name="categoryId"
            required
            defaultValue={row.categoryId}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          >
            {incomeCategories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <label htmlFor={`edit-income-name-${row.id}`} className="sr-only">
            {t("name")}
          </label>
          <input
            id={`edit-income-name-${row.id}`}
            name="name"
            type="text"
            autoComplete="off"
            defaultValue={row.name}
            required
            maxLength={80}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          />
        </div>
        <div className="flex items-stretch gap-2">
          <label htmlFor={`edit-income-amount-${row.id}`} className="sr-only">
            {t("amount")}
          </label>
          <div className="flex-1">
            <AmountInput
              value={draftAmount}
              onChange={setDraftAmount}
              id={`edit-income-amount-${row.id}`}
              name="amount-shim"
              ariaLabel={t("amount")}
              inputClassName="h-9"
              placeholder="1234.56"
            />
          </div>
          <Button type="submit" disabled={pending} size="default">
            {t("actions.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={onCancel}
          >
            {t("actions.cancel")}
          </Button>
        </div>
        {errorMessage && (
          <p role="alert" aria-live="polite" className="text-destructive text-xs">
            {errorMessage}
          </p>
        )}
      </form>
    </li>
  );
}

function errorToMessage(
  state: IncomeActionResult | null,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case "expenseCategory":
      return tv("expenseCategoryNotAllowed");
    case "inactiveCategory":
      return tv("categoryNotFound");
    case "categoryNotFound":
      return tv("categoryNotFound");
    case "incomeNotFound":
      return tv("incomeNotFound");
    case "monthNotFound":
      return tv("monthNotFound");
    case "amountFormat":
      return tv("amountFormat");
    case "validation":
      return tv("required");
  }
}
