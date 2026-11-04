"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AmountInput } from "@/components/amount-input";
import { ActualNameAutocomplete } from "@/components/actual-name-autocomplete";
import { centsToInputString, formatMoney } from "@/i18n/format";
import {
  addActualAction,
  deleteActualAction,
  editActualAction,
  moveActualAction,
  type ActualActionResult,
  type MoveActualActionResult,
} from "@/actions/actuals";
import { deleteMonthLineAction } from "@/actions/reserved-lines";
import {
  undoPassToActualAction,
  passToActualAction,
  type PassToActualActionResult,
} from "@/actions/pass-to-actual";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Pencil, Trash2, Undo2, ArrowRightCircle, ArrowLeftRight, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  MoveActualDrawer,
  type MoveTargetGroups,
  type MoveTargetOption,
} from "@/components/move-actual-drawer";
import type { ReservedLineRowData } from "@/app/[locale]/months/[year]/[month]/reserved-lines-types";
import { Collapsible } from "@/components/ui/collapsible";
import { SwipeAction } from "@/components/ui/swipe-action";
import type { ActualNameSuggestion } from "@/lib/actual-name-suggestions";

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
  committedReservedLines = [],
  nameSuggestions = [],
  moveTargets = EMPTY_MOVE_TARGETS,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  initialActuals: ActualRowData[];
  expenseCategories: CategoryOption[];
  committedReservedLines?: ReservedLineRowData[];
  nameSuggestions?: ActualNameSuggestion[];
  moveTargets?: MoveTargetGroups;
}) {
  const t = useTranslations("actuals");
  const [movedTo, setMovedTo] = useState<MoveTargetOption | null>(null);
  const dismissMoved = useCallback(() => setMovedTo(null), []);
  const canMove = moveTargets.previous.length + moveTargets.upcoming.length > 0;

  return (
    <section className="flex flex-col gap-3">
      <AddActualForm
        monthId={monthId}
        year={year}
        month={month}
        currency={currency}
        expenseCategories={expenseCategories}
        nameSuggestions={nameSuggestions}
      />

      {initialActuals.length > 0 && (
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
              moveTargets={canMove ? moveTargets : null}
              onMoved={setMovedTo}
            />
          ))}
        </ul>
      )}

      {movedTo && (
        <MovedToast target={movedTo} onDismiss={dismissMoved} />
      )}

      {initialActuals.length === 0 && committedReservedLines.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      )}

      {committedReservedLines.length > 0 && (
        <Collapsible title={t("committedReserved")} count={committedReservedLines.length}>
          <ul className="flex flex-col gap-1">
            {committedReservedLines.map((row) => (
              <CommittedReservedRow
                key={row.id}
                row={row}
                monthId={monthId}
                year={year}
                month={month}
                currency={currency}
              />
            ))}
          </ul>
        </Collapsible>
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
  nameSuggestions,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  expenseCategories: CategoryOption[];
  nameSuggestions: ActualNameSuggestion[];
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
      nameSuggestions={nameSuggestions}
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
  nameSuggestions,
  t,
  tv,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  expenseCategories: CategoryOption[];
  nameSuggestions: ActualNameSuggestion[];
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
      <div className="flex flex-wrap items-stretch gap-2">
        <label htmlFor="new-actual-category" className="sr-only">
          {t("category")}
        </label>
        <select
          id="new-actual-category"
          name="categoryId"
          required
          defaultValue={expenseCategories[0]?.id ?? ""}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        >
          {expenseCategories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        <label htmlFor="new-actual-name" className="sr-only">
          {t("name")}
        </label>
        <ActualNameAutocomplete
          id="new-actual-name"
          name="name"
          suggestions={nameSuggestions}
          placeholder={t("actions.placeholder")}
          required
          maxLength={80}
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
  moveTargets,
  onMoved,
}: {
  row: ActualRowData;
  monthId: string;
  year: number;
  month: number;
  currency: string;
  expenseCategories: CategoryOption[];
  moveTargets: MoveTargetGroups | null;
  onMoved: (target: MoveTargetOption) => void;
}) {
  const t = useTranslations("actuals");
  const tv = useTranslations("validation");
  const [editing, setEditing] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [undoPending, setUndoPending] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const canUndoPass = row.convertedFromLineId !== null && !row.editedAfterConversion;

  const handleDelete = async () => {
    if (deletePending) return;
    if (!window.confirm(t("actions.confirmDelete"))) return;
    setDeletePending(true);
    await deleteActualAction({ id: row.id, monthId, year, month });
    setDeletePending(false);
  };

  const handleUndo = async () => {
    if (!canUndoPass || undoPending) return;
    if (!window.confirm(t("actions.confirmUndoPass"))) return;
    setUndoPending(true);
    setUndoError(null);
    const result = await undoPassToActualAction({ actualId: row.id, monthId, year, month });
    setUndoPending(false);
    if (!result.ok) {
      setUndoError(errorToMessageUndo(result, tv));
    }
  };

  const handleMove = async (target: MoveTargetOption): Promise<boolean> => {
    if (movePending) return false;
    setMovePending(true);
    setMoveError(null);
    const result = await moveActualAction({ actualId: row.id, targetMonthId: target.id });
    setMovePending(false);
    if (!result.ok) {
      setMoveError(errorToMessageMove(result, tv));
      return false;
    }
    onMoved(target);
    return true;
  };

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
    <SwipeAction
      onSwipeLeft={handleDelete}
      onSwipeRight={canUndoPass ? handleUndo : undefined}
      leftIcon={canUndoPass ? <Undo2 className="size-5" /> : undefined}
      rightIcon={<Trash2 className="size-5" />}
      leftLabel={canUndoPass ? t("actions.undoPass") : undefined}
      rightLabel={t("actions.delete")}
      className="rounded-md border"
    >
      <div className="flex items-center gap-2 px-4 py-2 text-sm">
        <span className="min-w-0 flex-1 flex flex-col">
          <span className="truncate">{row.name}</span>
          <span className="text-muted-foreground truncate text-xs">
            {row.categoryName}
          </span>
          {row.observations && (
            <span className="text-muted-foreground truncate text-xs italic">
              {row.observations}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums whitespace-nowrap">
            {formatMoney(row.amountCents, currency)}
          </span>
          <RowActions
            canUndoPass={canUndoPass}
            onEdit={() => setEditing(true)}
            onMove={moveTargets ? () => setMoveOpen(true) : undefined}
            onUndo={handleUndo}
            onDelete={handleDelete}
            undoPending={undoPending}
            deletePending={deletePending}
            undoError={undoError}
          />
        </span>
        {!row.categoryActive && (
          <p className="text-muted-foreground basis-full text-xs">
            {t("historicalInactiveNote")}
          </p>
        )}
      </div>
      {moveTargets && (
        <MoveActualDrawer
          open={moveOpen}
          onOpenChange={setMoveOpen}
          ticketName={row.name}
          ticketAmountCents={row.amountCents}
          currency={currency}
          targets={moveTargets}
          showUndoLostNote={canUndoPass}
          pending={movePending}
          error={moveError}
          onConfirm={handleMove}
        />
      )}
    </SwipeAction>
  );
}

function RowActions({
  canUndoPass,
  onEdit,
  onMove,
  onUndo,
  onDelete,
  undoPending,
  deletePending,
  undoError,
}: {
  canUndoPass: boolean;
  onEdit: () => void;
  onMove?: () => void;
  onUndo: () => void;
  onDelete: () => void;
  undoPending: boolean;
  deletePending: boolean;
  undoError: string | null;
}) {
  const t = useTranslations("actuals");

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-1">
        <IconButton
          icon={<Pencil className="size-4" />}
          label={t("actions.edit")}
          onClick={onEdit}
        />
        {onMove && (
          <IconButton
            icon={<ArrowLeftRight className="size-4" />}
            label={t("move.action")}
            onClick={onMove}
          />
        )}
        {canUndoPass && (
          <IconButton
            icon={<Undo2 className="size-4" />}
            label={t("actions.undoPass")}
            disabled={undoPending}
            onClick={onUndo}
          />
        )}
        <IconButton
          icon={<Trash2 className="size-4" />}
          label={t("actions.delete")}
          destructive
          disabled={deletePending}
          onClick={onDelete}
        />
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
        <div className="flex flex-wrap items-stretch gap-2">
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
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
          >
            {expenseCategories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
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
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-0 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
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

function errorToMessageMove(
  state: Extract<MoveActualActionResult, { ok: false }>,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string {
  switch (state.error) {
    case "moveTargetOutOfWindow":
      return tv("moveTargetOutOfWindow");
    case "monthNotFound":
      return tv("monthNotFound");
    case "actualNotFound":
      return tv("actualNotFound");
    case "validation":
      return tv("required");
  }
}

const EMPTY_MOVE_TARGETS: MoveTargetGroups = { previous: [], upcoming: [] };
const MOVED_TOAST_MS = 6000;

// Success notice for UC-26: the moved row has already left the list (the
// action revalidated this page), so the notice lives on the screen, not the
// row. It links to the target month and dismisses itself.
function MovedToast({
  target,
  onDismiss,
}: {
  target: MoveTargetOption;
  onDismiss: () => void;
}) {
  const t = useTranslations("actuals");
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, MOVED_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [target, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-popover text-popover-foreground fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 lg:bottom-6 lg:left-64 mx-auto flex max-w-md items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg"
    >
      <span className="min-w-0 flex-1 truncate">
        {t("move.done", { month: target.label })}
      </span>
      <Link
        href={`/months/${target.year}/${target.month}`}
        className="text-primary shrink-0 font-medium underline-offset-4 hover:underline"
      >
        {t("move.openTarget")}
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("actions.cancel")}
        className="text-muted-foreground hover:text-foreground -mr-1 shrink-0 rounded p-1"
      >
        <X className="size-4" />
      </button>
    </div>
  );
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
    case "validation":
      return tv("required");
  }
}

// ---------------------------------------------------------------------------
// Committed reserved line row (display + pass to actual + delete)
// ---------------------------------------------------------------------------

function CommittedReservedRow({
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
  const t = useTranslations("actuals");
  const tv = useTranslations("validation");
  const [pending, setPending] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const handlePass = async () => {
    if (pending) return;
    if (!window.confirm(t("actions.confirmPassToActual"))) return;
    setPending(true);
    setPassError(null);
    const result = await passToActualAction({ lineId: row.id, monthId, year, month });
    setPending(false);
    if (!result.ok) {
      setPassError(errorToMessagePass(result, tv));
    }
  };

  const handleDelete = async () => {
    if (deletePending) return;
    if (!window.confirm(t("actions.confirmDeleteReserved"))) return;
    setDeletePending(true);
    await deleteMonthLineAction({ lineId: row.id, monthId, year, month });
    setDeletePending(false);
  };

  const isDirty = row.remainingCents !== row.originalCents;

  return (
    <SwipeAction
      onSwipeLeft={handleDelete}
      onSwipeRight={handlePass}
      leftIcon={<ArrowRightCircle className="size-5" />}
      rightIcon={<Trash2 className="size-5" />}
      leftLabel={t("actions.passToActual")}
      rightLabel={t("actions.delete")}
      className="rounded-md border"
    >
      <div className="flex items-center gap-2 px-4 py-2 text-sm">
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
          <IconButton
            icon={<ArrowRightCircle className="size-4" />}
            label={t("actions.passToActual")}
            disabled={pending}
            onClick={handlePass}
          />
          <IconButton
            icon={<Trash2 className="size-4" />}
            label={t("actions.delete")}
            destructive
            disabled={deletePending}
            onClick={handleDelete}
          />
        </span>
        {!row.categoryActive && (
          <p className="text-muted-foreground basis-full text-xs">
            {t("historicalInactiveNote")}
          </p>
        )}
        {passError && (
          <span
            role="alert"
            aria-live="polite"
            className="text-destructive basis-full text-xs"
          >
            {passError}
          </span>
        )}
      </div>
    </SwipeAction>
  );
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
