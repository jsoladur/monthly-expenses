"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { AmountInput } from "@/components/amount-input";
import { centsToInputString, formatMoney } from "@/i18n/format";
import {
  addMonthOnlyLineAction,
  deleteMonthLineAction,
  updateRemainingAmountAction,
  type ReservedLineActionResult,
} from "@/actions/reserved-lines";
import {
  passToActualAction,
  type PassToActualActionResult,
} from "@/actions/pass-to-actual";
import type { ReservedLineRowData, CategoryOption } from "@/app/[locale]/months/[year]/[month]/reserved-lines-screen";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Pencil, Trash2, ArrowRightCircle } from "lucide-react";

// ============================================================================
// Estimated reserved lines screen — separate section for estimated lines only.
//
// This component displays only the estimated reserved lines (not committed).
// It includes the ability to add new month-only lines (both committed and
// estimated), edit remaining amounts, and delete lines.
// ============================================================================

export function EstimatedReservedLinesScreen({
  monthId,
  year,
  month,
  currency,
  rows,
  expenseCategories,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  rows: ReservedLineRowData[];
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("reservedLines");

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noEstimated")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <EstimatedReservedLineRow
                key={row.id}
                row={row}
                monthId={monthId}
                year={year}
                month={month}
                currency={currency}
              />
            ))}
          </ul>
        )}
      </section>

      <AddMonthOnlyLineForm
        monthId={monthId}
        year={year}
        month={month}
        currency={currency}
        expenseCategories={expenseCategories}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row (read / edit-remaining / delete)
// ---------------------------------------------------------------------------

function EstimatedReservedLineRow({
  row,
  monthId,
  year,
  month,
  currency,
}: {
  row: ReservedLineRowData;
  monthId: string;
  year: number;
  month: number;
  currency: string;
}) {
  const t = useTranslations("reservedLines");
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditRemainingForm
        row={row}
        monthId={monthId}
        year={year}
        month={month}
        currency={currency}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  const isDirty = row.remainingCents !== row.originalCents;

  return (
    <li className="bg-card text-card-foreground flex flex-col gap-1 rounded-md border px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-col">
          <span>{row.name}</span>
          <span className="text-muted-foreground text-xs">
            {row.categoryName} · {t(`origin.${toCamelCase(row.origin)}`)}
          </span>
          {row.observations && (
            <span className="text-muted-foreground text-xs italic">
              {row.observations}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="flex flex-col items-end">
            <span
              className={
                isDirty
                  ? "tabular-nums font-medium"
                  : "tabular-nums"
              }
              aria-label={t("remaining")}
            >
              {formatMoney(row.remainingCents, currency)}
            </span>
            {isDirty && (
              <span className="text-muted-foreground text-xs">
                {t("amount")} {formatMoney(row.originalCents, currency)}
              </span>
            )}
          </span>
          <RowActions
            lineId={row.id}
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
  lineId,
  monthId,
  year,
  month,
  onEdit,
}: {
  lineId: string;
  monthId: string;
  year: number;
  month: number;
  onEdit: () => void;
}) {
  const t = useTranslations("reservedLines");
  const tv = useTranslations("validation");
  const [pending, setPending] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  const handlePass = async () => {
    if (pending) return;
    if (!window.confirm(t("actions.confirmPassToActual"))) return;
    setPending(true);
    setPassError(null);
    const result = await passToActualAction({ lineId, monthId, year, month });
    setPending(false);
    if (!result.ok) {
      setPassError(errorToMessagePass(result, tv));
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1">
        <IconButton
          icon={<Pencil className="size-4" />}
          label={t("actions.edit")}
          onClick={onEdit}
        />
        <IconButton
          icon={<ArrowRightCircle className="size-4" />}
          label={t("actions.passToActual")}
          disabled={pending}
          onClick={handlePass}
        />
        <form
          action={async () => {
            if (pending) return;
            if (!window.confirm(t("actions.confirmDelete"))) return;
            setPending(true);
            await deleteMonthLineAction({ lineId, monthId, year, month });
            setPending(false);
          }}
        >
          <IconButton
            icon={<Trash2 className="size-4" />}
            label={t("actions.delete")}
            destructive
            disabled={pending}
            type="submit"
          />
        </form>
      </span>
      {passError && (
        <span
          role="alert"
          aria-live="polite"
          className="text-destructive text-xs"
        >
          {passError}
        </span>
      )}
    </span>
  );
}

function EditRemainingForm({
  row,
  monthId,
  year,
  month,
  currency,
  onCancel,
  onSaved,
}: {
  row: ReservedLineRowData;
  monthId: string;
  year: number;
  month: number;
  currency: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("reservedLines");
  const tv = useTranslations("validation");
  const [draftAmount, setDraftAmount] = useState(centsToInputString(row.remainingCents));

  const [state, formAction, pending] = useActionState<ReservedLineActionResult | null, FormData>(
    async (_prev, formData) => {
      const payload = {
        lineId: row.id,
        monthId,
        year,
        month,
        remainingAmount: readRemainingAmount(formData, draftAmount),
      };
      const result = await updateRemainingAmountAction(payload);
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
      <div className="flex flex-col gap-1">
        <span className="font-medium">{row.name}</span>
        <span className="text-muted-foreground text-xs">
          {row.categoryName} · {t("amount")} {formatMoney(row.originalCents, currency)}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{t("remainingHelp")}</p>
      <form action={formAction} className="flex flex-col gap-2">
        <label
          htmlFor={`edit-remaining-${row.id}`}
          className="sr-only"
        >
          {t("remaining")}
        </label>
        <div className="flex items-stretch gap-2">
          <div className="flex-1">
            <AmountInput
              value={draftAmount}
              onChange={setDraftAmount}
              id={`edit-remaining-${row.id}`}
              name="amount-shim"
              ariaLabel={t("remaining")}
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

// ---------------------------------------------------------------------------
// Add form (month-only line)
// ---------------------------------------------------------------------------

function AddMonthOnlyLineForm({
  monthId,
  year,
  month,
  currency,
  expenseCategories,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  expenseCategories: CategoryOption[];
}) {
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
    <AddMonthOnlyLineFormBody
      monthId={monthId}
      year={year}
      month={month}
      currency={currency}
      expenseCategories={expenseCategories}
    />
  );
}

function AddMonthOnlyLineFormBody({
  monthId,
  year,
  month,
  currency,
  expenseCategories,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("reservedLines");
  const tv = useTranslations("validation");
  const [bumpOnSuccess, setBumpOnSuccess] = useState(0);
  const [draftAmount, setDraftAmount] = useState("");

  const [state, formAction, pending] = useActionState<ReservedLineActionResult | null, FormData>(
    async (_prev, formData) => {
      const payload = {
        monthId,
        year,
        month,
        categoryId: String(formData.get("categoryId") ?? ""),
        name: String(formData.get("name") ?? "").trim(),
        observations: readObservations(formData),
        amount: draftAmount.trim(),
        kind: (String(formData.get("kind") ?? "estimated") === "committed"
          ? "committed"
          : "estimated") as "committed" | "estimated",
      };
      const result = await addMonthOnlyLineAction(payload);
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
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{t("new")}</h2>
      <form key={formKey} action={formAction} className="flex flex-col gap-2">
        <div className="flex items-stretch gap-2">
          <label htmlFor="new-reserved-category" className="sr-only">
            {t("category")}
          </label>
          <select
            id="new-reserved-category"
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
          <label htmlFor="new-reserved-kind" className="sr-only">
            {t("actions.selectKind")}
          </label>
          <select
            id="new-reserved-kind"
            name="kind"
            required
            defaultValue="estimated"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-32 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          >
            <option value="committed">{t("kind.committed")}</option>
            <option value="estimated">{t("kind.estimated")}</option>
          </select>
        </div>
        <label htmlFor="new-reserved-name" className="sr-only">
          {t("name")}
        </label>
        <input
          id="new-reserved-name"
          name="name"
          type="text"
          autoComplete="off"
          placeholder={t("actions.placeholder")}
          required
          maxLength={80}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        />
        <label htmlFor="new-reserved-amount" className="sr-only">
          {t("amount")}
        </label>
        <div className="flex items-stretch gap-2">
          <div className="flex-1">
            <AmountInput
              value={draftAmount}
              onChange={setDraftAmount}
              id="new-reserved-amount"
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
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorToMessage(
  state: ReservedLineActionResult | null,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case "incomeCategory":
      return tv("incomeCategoryNotAllowed");
    case "inactiveCategory":
      return tv("categoryNotFound");
    case "categoryNotFound":
      return tv("categoryNotFound");
    case "monthLineNotFound":
      return tv("reservedLineNotFound");
    case "monthNotFound":
      return tv("monthNotFound");
    case "amountFormat":
      return tv("amountFormat");
    case "validation":
      return tv("required");
  }
}

function readObservations(formData: FormData): string | null {
  const value = formData.get("observations");
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readRemainingAmount(formData: FormData, fallback: string): string {
  const value = formData.get("amount-shim");
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback.trim();
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function errorToMessagePass(
  state: Extract<PassToActualActionResult, { ok: false }>,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string {
  switch (state.error) {
    case "monthLineNotFound":
      return tv("reservedLineNotFound");
    case "actualNotFound":
      return tv("actualNotFound");
    case "notUndoable":
      return tv("notUndoable");
    case "undoForbiddenAfterEdit":
      return tv("cannotUndoPass");
    case "validation":
      return tv("required");
  }
}
