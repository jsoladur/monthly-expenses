"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { AmountInput } from "@/components/amount-input";
import { centsToInputString, formatMoney } from "@/i18n/format";
import {
  addActualAction,
  deleteActualAction,
  editActualAction,
  type ActualActionResult,
} from "@/actions/actuals";
import {
  undoPassToActualAction,
  type PassToActualActionResult,
} from "@/actions/pass-to-actual";
import { OverspendBadge } from "@/app/[locale]/months/[year]/[month]/overspend-badge";
import type { OverspendWarning } from "@/server/services/summary";
import { Button } from "@/components/ui/button";

// ============================================================================
// Actuals screen (UC-08) — interactive part of the workspace's actuals block.
//
// Reads come from the RSC parent (`page.tsx`) which serializes each row's
// `amountCents` (integer, ADR-5 / ARCH §8) plus the category map. The screen
// is purely presentational + tab/form state; mutations happen through the
// `addActualAction` / `editActualAction` / `deleteActualAction` server actions
// which revalidate `/[locale]/months/<year>/<month>` on success.
//
// Historical actuals keep rendering even after their category is deactivated
// (PRD §6.2). The RSC passes the FULL category map (active + inactive) so the
// row can look up its category name; we render a muted note when the
// category is inactive.
//
// Adding an actual never auto-balances any envelope (PRD §7.2 / §7.3); the
// reserve remains a manual knob.
// ============================================================================

export interface ActualRowData {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  name: string;
  observations: string | null;
  amountCents: number;
  // Pass-to-actual (UC-10, PRD §7.5): `convertedFromLineId` is non-null when
  // the actual was created by `passToActual` (not by `addActual`). Undo is
  // allowed only while `editedAfterConversion` is false; the moment a user
  // edits this actual, the gate closes.
  convertedFromLineId: string | null;
  editedAfterConversion: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export function ActualsScreen({
  monthId,
  year,
  month,
  currency,
  initialActuals,
  expenseCategories,
  overspendWarnings = [],
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  initialActuals: ActualRowData[];
  expenseCategories: CategoryOption[];
  overspendWarnings?: OverspendWarning[];
}) {
  const t = useTranslations("actuals");

  // Surface one badge per overspending category that has at least one
  // ticket in the open month (PRD §7.4). Same dedup rule as
  // ReservedLinesScreen — never repeat a badge for the same category.
  const warningByCategoryId = new Map<string, OverspendWarning>();
  for (const warning of overspendWarnings) {
    if (initialActuals.some((row) => row.categoryId === warning.categoryId)) {
      warningByCategoryId.set(warning.categoryId, warning);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t("title")}</h2>

      <AddActualForm
        monthId={monthId}
        year={year}
        month={month}
        currency={currency}
        expenseCategories={expenseCategories}
      />

      {initialActuals.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <>
          {warningByCategoryId.size > 0 && (
            <div className="flex flex-col gap-1">
              {Array.from(warningByCategoryId.values()).map((warning) => (
                <OverspendBadge
                  key={warning.categoryId}
                  warning={warning}
                  currency={currency}
                />
              ))}
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {initialActuals.map((row) => (
              <ActualRow
                key={row.id}
                row={row}
                monthId={monthId}
                year={year}
                month={month}
                currency={currency}
                expenseCategories={expenseCategories}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------------

function AddActualForm({
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
  const t = useTranslations("actuals");
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
    <AddActualFormBody
      monthId={monthId}
      year={year}
      month={month}
      currency={currency}
      expenseCategories={expenseCategories}
      t={t}
      tv={tv}
    />
  );
}

function AddActualFormBody({
  monthId,
  year,
  month,
  currency,
  expenseCategories,
  t,
  tv,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  expenseCategories: CategoryOption[];
  t: ReturnType<typeof useTranslations<"actuals">>;
  tv: ReturnType<typeof useTranslations<"validation">>;
}) {
  const [bumpOnSuccess, setBumpOnSuccess] = useState(0);
  const [draftAmount, setDraftAmount] = useState("");
  const [state, formAction, pending] = useActionState<ActualActionResult | null, FormData>(
    async (_prev, formData) => {
      const payload = {
        monthId,
        year,
        month,
        categoryId: String(formData.get("categoryId") ?? ""),
        name: String(formData.get("name") ?? "").trim(),
        observations: readObservations(formData),
        amount: draftAmount.trim(),
      };
      const result = await addActualAction(payload);
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
        <label htmlFor="new-actual-category" className="sr-only">
          {t("category")}
        </label>
        <select
          id="new-actual-category"
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
        <label htmlFor="new-actual-name" className="sr-only">
          {t("name")}
        </label>
        <input
          id="new-actual-name"
          name="name"
          type="text"
          autoComplete="off"
          placeholder={t("actions.placeholder")}
          required
          maxLength={80}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        />
      </div>
      <label htmlFor="new-actual-observations" className="sr-only">
        {t("observations")}
      </label>
      <input
        id="new-actual-observations"
        name="observations"
        type="text"
        autoComplete="off"
        placeholder={t("actions.observationsPlaceholder")}
        maxLength={500}
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
      />
      <div className="flex items-stretch gap-2">
        <label htmlFor="new-actual-amount" className="sr-only">
          {t("amount")}
        </label>
        <div className="flex-1">
          <AmountInput
            value={draftAmount}
            onChange={setDraftAmount}
            id="new-actual-amount"
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

function ActualRow({
  row,
  monthId,
  year,
  month,
  currency,
  expenseCategories,
}: {
  row: ActualRowData;
  monthId: string;
  year: number;
  month: number;
  currency: string;
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("actuals");
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditActualForm
        row={row}
        monthId={monthId}
        year={year}
        month={month}
        expenseCategories={expenseCategories}
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
          {row.observations && (
            <span className="text-muted-foreground text-xs italic">
              {row.observations}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums">
            {formatMoney(row.amountCents, currency)}
          </span>
          <RowActions
            rowId={row.id}
            canUndoPass={row.convertedFromLineId !== null && !row.editedAfterConversion}
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
  canUndoPass,
  monthId,
  year,
  month,
  onEdit,
}: {
  rowId: string;
  canUndoPass: boolean;
  monthId: string;
  year: number;
  month: number;
  onEdit: () => void;
}) {
  const t = useTranslations("actuals");
  const tv = useTranslations("validation");
  const [pending, setPending] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  const handleUndo = async () => {
    if (pending) return;
    if (!window.confirm(t("actions.confirmUndoPass"))) return;
    setPending(true);
    setUndoError(null);
    const result = await undoPassToActualAction({ actualId: rowId, monthId, year, month });
    setPending(false);
    if (!result.ok) {
      setUndoError(errorToMessageUndo(result, tv));
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground px-2 text-xs underline-offset-4 hover:underline"
        >
          {t("actions.edit")}
        </button>
        {canUndoPass && (
          <button
            type="button"
            onClick={handleUndo}
            disabled={pending}
            className="text-muted-foreground hover:text-foreground px-2 text-xs underline-offset-4 hover:underline"
          >
            {t("actions.undoPass")}
          </button>
        )}
        <form
          action={async () => {
            if (pending) return;
            if (!window.confirm(t("actions.confirmDelete"))) return;
            setPending(true);
            await deleteActualAction({ id: rowId, monthId, year, month });
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
      {undoError && (
        <span
          role="alert"
          aria-live="polite"
          className="text-destructive text-xs"
        >
          {undoError}
        </span>
      )}
    </span>
  );
}

function EditActualForm({
  row,
  monthId,
  year,
  month,
  expenseCategories,
  onCancel,
  onSaved,
}: {
  row: ActualRowData;
  monthId: string;
  year: number;
  month: number;
  expenseCategories: CategoryOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("actuals");
  const tv = useTranslations("validation");
  const [draftAmount, setDraftAmount] = useState(centsToInputString(row.amountCents));

  const [state, formAction, pending] = useActionState<ActualActionResult | null, FormData>(
    async (_prev, formData) => {
      const payload = {
        id: row.id,
        monthId,
        year,
        month,
        categoryId: String(formData.get("categoryId") ?? ""),
        name: String(formData.get("name") ?? "").trim(),
        observations: readObservations(formData),
        amount: draftAmount.trim(),
      };
      const result = await editActualAction(payload);
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
            htmlFor={`edit-actual-category-${row.id}`}
            className="sr-only"
          >
            {t("category")}
          </label>
          <select
            id={`edit-actual-category-${row.id}`}
            name="categoryId"
            required
            defaultValue={row.categoryId}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          >
            {expenseCategories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <label htmlFor={`edit-actual-name-${row.id}`} className="sr-only">
            {t("name")}
          </label>
          <input
            id={`edit-actual-name-${row.id}`}
            name="name"
            type="text"
            autoComplete="off"
            defaultValue={row.name}
            required
            maxLength={80}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          />
        </div>
        <label
          htmlFor={`edit-actual-observations-${row.id}`}
          className="sr-only"
        >
          {t("observations")}
        </label>
        <input
          id={`edit-actual-observations-${row.id}`}
          name="observations"
          type="text"
          autoComplete="off"
          defaultValue={row.observations ?? ""}
          placeholder={t("actions.observationsPlaceholder")}
          maxLength={500}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        />
        <div className="flex items-stretch gap-2">
          <label htmlFor={`edit-actual-amount-${row.id}`} className="sr-only">
            {t("amount")}
          </label>
          <div className="flex-1">
            <AmountInput
              value={draftAmount}
              onChange={setDraftAmount}
              id={`edit-actual-amount-${row.id}`}
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
  state: ActualActionResult | null,
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
    case "actualNotFound":
      return tv("actualNotFound");
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

function errorToMessageUndo(
  state: Extract<PassToActualActionResult, { ok: false }>,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string {
  switch (state.error) {
    case "actualNotFound":
      return tv("actualNotFound");
    case "notUndoable":
      return tv("notUndoable");
    case "undoForbiddenAfterEdit":
      return tv("cannotUndoPass");
    case "monthLineNotFound":
      return tv("reservedLineNotFound");
    case "estimatedLineCannotPass":
      return tv("estimatedLineCannotPassToActual");
    case "validation":
      return tv("required");
  }
}
