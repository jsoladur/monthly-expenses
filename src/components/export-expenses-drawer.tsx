"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FileSpreadsheet } from "lucide-react";
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
import { exportExpensesAction } from "@/actions/export";
import type { ExportPeriod } from "@/lib/export-selection";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ExportMode = "all" | "year" | "months";

export type ExportMonthOption = {
  year: number;
  month: number;
  label: string;
};

function downloadBase64Xlsx(filename: string, base64: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function periodKey(period: ExportPeriod): string {
  return `${period.year}-${period.month}`;
}

export function ExportExpensesDrawer({
  years,
  months,
}: {
  years: number[];
  months: ExportMonthOption[];
}) {
  const t = useTranslations("export");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ExportMode>("all");
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMonths = months.length > 0;
  const selectedPeriods = useMemo(
    () => months.filter((item) => selectedKeys.has(periodKey(item))),
    [months, selectedKeys],
  );

  const canDownload =
    hasMonths &&
    !pending &&
    (mode === "all" ||
      (mode === "year" && selectedYears.size > 0) ||
      (mode === "months" && selectedPeriods.length > 0));

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setMode("all");
      setSelectedYears(new Set());
      setSelectedKeys(new Set());
      setError(null);
    }
    setOpen(next);
  };

  const toggleYear = (option: number) => {
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      return next;
    });
  };

  const toggleMonth = (option: ExportMonthOption) => {
    const key = periodKey(option);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDownload = async () => {
    if (!canDownload) return;
    setPending(true);
    setError(null);
    const payload =
      mode === "all"
        ? { mode: "all" as const }
        : mode === "year"
          ? { mode: "year" as const, years: [...selectedYears] }
          : {
              mode: "months" as const,
              periods: selectedPeriods.map((item) => ({
                year: item.year,
                month: item.month,
              })),
            };
    try {
      const result = await exportExpensesAction(payload);
      if (!result.ok) {
        setError(
          result.error === "nothingToExport"
            ? tv("nothingToExport")
            : tc("error"),
        );
        return;
      }
      downloadBase64Xlsx(result.filename, result.base64);
      setOpen(false);
    } catch {
      setError(tc("error"));
    } finally {
      setPending(false);
    }
  };

  const modeCard = (
    value: ExportMode,
    label: string,
    help: string,
  ) => {
    const selected = mode === value;
    return (
      <button
        key={value}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => setMode(value)}
        className={`flex min-h-11 flex-col items-start justify-center rounded-md border px-3 py-2 text-left transition-colors focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none ${
          selected
            ? "border-border bg-secondary text-foreground border-l-primary border-l-4"
            : "border-border bg-card text-foreground hover:bg-muted/50"
        }`}
      >
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted-foreground text-xs leading-snug">{help}</span>
      </button>
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 shrink-0"
        onClick={() => handleOpenChange(true)}
      >
        <FileSpreadsheet />
        {t("button")}
      </Button>
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerPortal>
          <DrawerBackdrop />
          <DrawerViewport>
            <DrawerPopup>
              <DrawerContent>
                <div className="bg-muted mx-auto mb-1 h-1 w-10 rounded-full" aria-hidden />
                <DrawerTitle>{t("title")}</DrawerTitle>
                <DrawerDescription>{t("body")}</DrawerDescription>
                <div
                  role="radiogroup"
                  aria-label={t("title")}
                  className="flex flex-col gap-1 pt-1"
                >
                  {modeCard("all", t("mode.all"), t("mode.allHelp"))}
                  {modeCard("year", t("mode.year"), t("mode.yearHelp"))}
                  {modeCard("months", t("mode.months"), t("mode.monthsHelp"))}
                </div>
                {mode === "year" && (
                  <div
                    role="group"
                    aria-label={t("yearList")}
                    className="flex max-h-48 flex-col gap-1 overflow-y-auto pt-2"
                  >
                    {years.length === 0 ? (
                      <p className="text-muted-foreground text-sm">{t("empty")}</p>
                    ) : (
                      years.map((option) => {
                        const checked = selectedYears.has(option);
                        return (
                          <button
                            key={option}
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => toggleYear(option)}
                            className={`flex min-h-11 items-center rounded-md border px-3 text-left text-sm transition-colors focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none ${
                              checked
                                ? "border-border bg-secondary text-foreground border-l-primary border-l-4"
                                : "border-border bg-card text-foreground hover:bg-muted/50"
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {mode === "months" && (
                  <div
                    role="group"
                    aria-label={t("monthList")}
                    className="flex max-h-48 flex-col gap-1 overflow-y-auto pt-2"
                  >
                    {months.length === 0 ? (
                      <p className="text-muted-foreground text-sm">{t("empty")}</p>
                    ) : (
                      months.map((option) => {
                        const checked = selectedKeys.has(periodKey(option));
                        return (
                          <button
                            key={periodKey(option)}
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => toggleMonth(option)}
                            className={`flex min-h-11 items-center rounded-md border px-3 text-left text-sm transition-colors focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none ${
                              checked
                                ? "border-border bg-secondary text-foreground border-l-primary border-l-4"
                                : "border-border bg-card text-foreground hover:bg-muted/50"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {!hasMonths && mode === "all" && (
                  <p className="text-muted-foreground text-sm">{t("empty")}</p>
                )}
                {mode === "year" && hasMonths && selectedYears.size === 0 && (
                  <p className="text-muted-foreground text-xs">{t("needYear")}</p>
                )}
                {mode === "months" && hasMonths && selectedPeriods.length === 0 && (
                  <p className="text-muted-foreground text-xs">{t("needMonth")}</p>
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
                    onClick={() => setOpen(false)}
                  >
                    {tc("cancel")}
                  </Button>
                  <Button
                    type="button"
                    className="h-11 flex-1"
                    disabled={!canDownload}
                    onClick={() => void handleDownload()}
                  >
                    {pending ? tc("loading") : t("download")}
                  </Button>
                </div>
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </>
  );
}
