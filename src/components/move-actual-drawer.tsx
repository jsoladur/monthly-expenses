"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from "@/components/ui/drawer";
import { formatMoney } from "@/i18n/format";

// ============================================================================
// Move-an-actual picker (UC-26). Same bottom-sheet pattern as UC-18's
// pass-to-upcoming drawer. Targets come pre-computed from the RSC (once per
// page, not per row): earlier months newest-first (≤ 3), later months
// oldest-first. Each row carries the target's current left-over so the user
// can judge whether there is room before moving the ticket there.
// ============================================================================

export interface MoveTargetOption {
  id: string;
  year: number;
  month: number;
  /** Locale month name + year, e.g. "December 2026". */
  label: string;
  leftOverCents: number;
  /** Before the current calendar month: the figure is consolidated. */
  isPast: boolean;
}

export interface MoveTargetGroups {
  previous: MoveTargetOption[];
  upcoming: MoveTargetOption[];
}

export function MoveActualDrawer({
  open,
  onOpenChange,
  ticketName,
  ticketAmountCents,
  currency,
  targets,
  showUndoLostNote,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketName: string;
  ticketAmountCents: number;
  currency: string;
  targets: MoveTargetGroups;
  showUndoLostNote: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: (target: MoveTargetOption) => Promise<boolean>;
}) {
  const t = useTranslations("actuals");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const all = [...targets.previous, ...targets.upcoming];
  const selected = all.find((m) => m.id === selectedId) ?? null;

  const handleOpenChange = (next: boolean) => {
    if (next) setSelectedId(null);
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!selected || pending) return;
    const ok = await onConfirm(selected);
    if (ok) onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup>
            <DrawerContent>
              <div className="bg-muted mx-auto mb-1 h-1 w-10 rounded-full" aria-hidden />
              <DrawerTitle>{t("move.title")}</DrawerTitle>
              <DrawerDescription className="flex items-baseline gap-2">
                <span className="text-foreground min-w-0 truncate font-medium">
                  {ticketName}
                </span>
                <span aria-hidden>·</span>
                <span className="tabular-nums whitespace-nowrap">
                  {formatMoney(ticketAmountCents, currency)}
                </span>
              </DrawerDescription>

              <div
                role="radiogroup"
                aria-label={t("move.title")}
                className="flex flex-col gap-4 pt-1"
              >
                {targets.previous.length > 0 && (
                  <TargetGroup
                    heading={t("move.earlier")}
                    options={targets.previous}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    currency={currency}
                  />
                )}
                {targets.upcoming.length > 0 && (
                  <TargetGroup
                    heading={t("move.later")}
                    options={targets.upcoming}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    currency={currency}
                    scroll
                  />
                )}
              </div>

              {showUndoLostNote && (
                <p className="bg-muted/40 border-border/40 text-muted-foreground rounded-md border px-3 py-2 text-xs leading-relaxed">
                  {t("move.undoLostNote")}
                </p>
              )}
              {error && (
                <p role="alert" aria-live="polite" className="text-destructive text-xs">
                  {error}
                </p>
              )}
              <div className="flex items-stretch gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => onOpenChange(false)}
                >
                  {t("actions.cancel")}
                </Button>
                <Button
                  type="button"
                  className="h-11 flex-[2] truncate"
                  disabled={pending || !selected}
                  onClick={() => void handleConfirm()}
                >
                  {selected
                    ? t("move.confirm", { month: selected.label })
                    : t("move.action")}
                </Button>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  );
}

function TargetGroup({
  heading,
  options,
  selectedId,
  onSelect,
  currency,
  scroll = false,
}: {
  heading: string;
  options: MoveTargetOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  currency: string;
  scroll?: boolean;
}) {
  const t = useTranslations("actuals");
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
        {heading}
      </p>
      <div
        className={`flex flex-col gap-1 ${scroll ? "max-h-64 overflow-y-auto overscroll-contain" : ""}`}
      >
        {options.map((option) => {
          const isSelected = option.id === selectedId;
          const negative = option.leftOverCents < 0;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(option.id)}
              className={`flex min-h-11 shrink-0 items-center gap-3 rounded-md border px-3 text-left text-sm transition-colors focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none ${
                isSelected
                  ? "border-border bg-secondary text-foreground border-l-primary border-l-4"
                  : "border-border bg-card text-foreground hover:bg-muted/50"
              }`}
            >
              <span className="min-w-0 flex-1 truncate first-letter:uppercase">{option.label}</span>
              <span
                className={`text-xs tabular-nums whitespace-nowrap ${
                  negative ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {t(option.isPast ? "move.leftOverPast" : "move.leftOver", {
                  amount: formatMoney(option.leftOverCents, currency),
                })}
              </span>
              <Check
                aria-hidden
                className={`size-4 shrink-0 ${isSelected ? "text-primary" : "invisible"}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
