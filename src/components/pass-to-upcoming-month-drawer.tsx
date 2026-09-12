"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import type { UpcomingMonthOption } from "@/app/[locale]/months/[year]/[month]/reserved-lines-types";

export function PassToUpcomingMonthDrawer({
  open,
  onOpenChange,
  months,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  months: UpcomingMonthOption[];
  pending: boolean;
  error: string | null;
  onConfirm: (targetMonthId: string) => Promise<boolean>;
}) {
  const t = useTranslations("reservedLines");
  const [selectedId, setSelectedId] = useState(months[0]?.id ?? "");

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setSelectedId(months[0]?.id ?? "");
    }
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!selectedId || pending) return;
    const ok = await onConfirm(selectedId);
    if (ok) {
      onOpenChange(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup>
            <DrawerContent>
              <div className="bg-muted mx-auto mb-1 h-1 w-10 rounded-full" aria-hidden />
              <DrawerTitle>{t("actions.passToUpcomingTitle")}</DrawerTitle>
              <DrawerDescription>{t("actions.passToUpcomingBody")}</DrawerDescription>
              <div
                role="radiogroup"
                aria-label={t("actions.passToUpcomingMonthList")}
                className="flex flex-col gap-1 pt-1"
              >
                {months.map((option) => {
                  const selected = option.id === selectedId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSelectedId(option.id)}
                      className={`flex min-h-11 items-center rounded-md border px-3 text-left text-sm transition-colors focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none ${
                        selected
                          ? "border-border bg-secondary text-foreground border-l-estimated border-l-4"
                          : "border-border bg-card text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
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
                  className="h-11 flex-1"
                  disabled={pending || !selectedId}
                  onClick={() => void handleConfirm()}
                >
                  {t("actions.passToUpcomingConfirm")}
                </Button>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  );
}
