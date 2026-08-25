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
import { OverspendBadge } from "@/app/[locale]/months/[year]/[month]/overspend-badge";
import type { OverspendWarning } from "@/server/services/summary";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Pencil, Trash2, ArrowRightCircle } from "lucide-react";

// ============================================================================
// Reserved lines screen (UC-09) — interactive part of the workspace's
// reserved-lines block (PRD §6.6 / §7.3 / §7.8 / §13, UC-11 / UC-18 / UC-19).
//
// Reads come from the RSC parent (`page.tsx`) which serializes each line's
// `amountCents` (integer, ADR-5 / ARCH §8) plus the category map. The screen
// is purely presentational + tab/form state; mutations happen through the
// `updateRemainingAmountAction` / `addMonthOnlyLineAction` /
// `deleteMonthLineAction` server actions which revalidate the workspace on
// success.
//
// Grouping: lines are pre-grouped by `kind` (`committed` / `estimated`) in
// the RSC so the user can scan them in the order PRD §10 prescribes (screen
// 4). Within each kind, lines are ordered with `cloned` first, then
// `month_only`, so the snapshot rows read as the "what the template said"
// and the one-offs read as the "what I added on top" (PRD §7.8).
//
// Help copy follows PRD §19: "Tickets do not reduce this number. Decrease it
// yourself when you want the reserve to drop." Editing a remaining NEVER
// creates an actual ticket (PRD §7.3) — the reserve stays a manual knob.
// ============================================================================

export type ReservedLineOrigin = "cloned" | "month_only";
export type ReservedLineKind = "committed" | "estimated";

export interface ReservedLineRowData {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  name: string;
  observations: string | null;
  remainingCents: number;
  originalCents: number;
  kind: ReservedLineKind;
  origin: ReservedLineOrigin;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface ReservedLineGroup {
  kind: ReservedLineKind;
  rows: ReservedLineRowData[];
}

export function ReservedLinesScreen({
  monthId,
  year,
  month,
  currency,
  groups,
  expenseCategories,
  overspendWarnings = [],
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  groups: ReservedLineGroup[];
  expenseCategories: CategoryOption[];
  overspendWarnings?: OverspendWarning[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <AddMonthOnlyLineForm
        monthId={monthId}
        year={year}
        month={month}
        currency={currency}
        expenseCategories={expenseCategories}
      />
      {groups.map((group) => (
        <ReservedLineGroupSection
          key={group.kind}
          group={group}
          monthId={monthId}
          year={year}
          month={month}
          currency={currency}
          overspendWarnings={overspendWarnings}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One group (committed or estimated)
// ---------------------------------------------------------------------------

function ReservedLineGroupSection({
  group,
  monthId,
  year,
  month,
  currency,
  overspendWarnings,
}: {
  group: ReservedLineGroup;
  monthId: string;
  year: number;
  month: number;
  currency: string;
  overspendWarnings: OverspendWarning[];
}) {
  const t = useTranslations("reservedLines");
  const title =
    group.kind === "committed" ? t("committedTitle") : t("estimatedTitle");
  const empty =
    group.kind === "committed" ? t("noCommitted") : t("noEstimated");

  // Surface one overspend badge per category that has an overspending row
  // inside THIS group (PRD §7.4). The badge is informational only — never
  // blocks. We collect the set of categoryIds that have at least one row
  // in the group AND a warning, so the same badge doesn't repeat on every
  // row of the same category.
  const warningByCategoryId = new Map<string, OverspendWarning>();
  for (const warning of overspendWarnings) {
    if (group.rows.some((row) => row.categoryId === warning.categoryId)) {
      warningByCategoryId.set(warning.categoryId, warning);
    }
  }

  return (
    <section
      aria-labelledby={`reserved-${group.kind}`}
      className="flex flex-col gap-2"
    >
      <h2 id={`reserved-${group.kind}`} className="text-base font-semibold">
        {title}
      </h2>
      <p className="text-muted-foreground text-xs">
        {t("actions.passToActualHelp")}
      </p>
      {group.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
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
            {group.rows.map((row) => (
              <ReservedLineRow
                key={row.id}
                row={row}
                monthId={monthId}
                year={year}
                month={month}
                currency={currency}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row (read / edit-remaining / delete)
// ---------------------------------------------------------------------------

function ReservedLineRow({
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
    <li className="bg-card text-card-foreground flex items-center gap-2 rounded-md border px-4 py-2 text-sm">
      <span className="min-w-0 flex-1 flex flex-col">
        <span className="truncate">{row.name}</span>
        <span className="text-muted-foreground truncate text-xs">
          {row.categoryName} · {t(`origin.${toCamelCase(row.origin)}`)}
        </span>
        {row.observations && (
          <span className="text-muted-foreground truncate text-xs italic">
            {row.observations}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="flex flex-col items-end">
          <span
            className={
              isDirty
                ? "tabular-nums whitespace-nowrap font-medium"
                : "tabular-nums whitespace-nowrap"
            }
            aria-label={t("remaining")}
          >
            {formatMoney(row.remainingCents, currency)}
          </span>
          {isDirty && (
            <span className="text-muted-foreground text-xs whitespace-nowrap">
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
      {!row.categoryActive && (
        <p className="text-muted-foreground basis-full text-xs">
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
  // The add form has no observations input — the field is reserved for a
  // future edit form. Kept here so the action signature stays stable and
  // a later slice can add the input without touching this file.
  const value = formData.get("observations");
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readRemainingAmount(formData: FormData, fallback: string): string {
  // The AmountInput is fully controlled and writes to a "amount-shim" name;
  // fall back to the React state so server-side validation still sees the
  // intended value if the form posts without a shim (e.g. the input was
  // blurred mid-edit). The Zod amountSchema in the action is the security
  // boundary either way.
  const value = formData.get("amount-shim");
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback.trim();
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

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
