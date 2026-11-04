"use client";

import { useId, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Menu } from "@base-ui/react/menu";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { CircleAlert, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteMonthAction } from "@/actions/months";
import { matchesMonthLabel } from "@/lib/month-delete";
import { cn } from "@/lib/utils";

// ============================================================================
// Month workspace header overflow menu (UC-27).
//
// Today it holds a single destructive item, "Delete month", always last.
// The confirmation is an alert dialog that lists what goes away and only
// enables the destructive button once the user has typed the month label as
// shown in the header (trimmed, case-insensitive). The server re-checks id +
// tenant; the typed label is a UI guard only. On success the action
// redirects to Home, so this component never handles a "done" state.
// ============================================================================

export function MonthActionsMenu({
  monthId,
  label,
  counts,
}: {
  monthId: string;
  /** Localized "{month} {year}", exactly as the page heading renders it. */
  label: string;
  counts: { incomes: number; lines: number; actuals: number };
}) {
  const t = useTranslations("months.delete");
  const locale = useLocale();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const matches = matchesMonthLabel(typed, label, locale);

  const onOpenChange = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setTyped("");
      setError(false);
    }
  };

  const confirm = () => {
    if (!matches || pending) return;
    setError(false);
    startTransition(async () => {
      const result = await deleteMonthAction({ monthId });
      // Only reached on failure — success redirects to Home.
      if (result && !result.ok) setError(true);
    });
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={t("actions")}
          title={t("actions")}
          className="text-muted-foreground hover:text-foreground hover:bg-muted data-popup-open:bg-muted data-popup-open:text-foreground focus-visible:ring-ring/50 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-3"
        >
          <MoreHorizontal className="size-5" aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="z-50 outline-none" side="bottom" align="end" sideOffset={6}>
            <Menu.Popup className="bg-popover text-popover-foreground min-w-48 origin-(--transform-origin) rounded-lg border p-1 shadow-lg outline-none transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
              <Menu.Item
                onClick={() => setOpen(true)}
                className="text-destructive data-highlighted:bg-destructive/10 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium outline-none select-none"
              >
                <Trash2 className="size-4" aria-hidden />
                {t("menu")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup className="bg-card text-card-foreground fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-xl border p-5 shadow-xl outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-full"
              >
                <Trash2 className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col gap-1 pt-0.5">
                <AlertDialog.Title className="text-lg leading-tight font-semibold">
                  {t("title", { month: label })}
                </AlertDialog.Title>
                <AlertDialog.Description className="text-muted-foreground text-sm">
                  {t("lead")}
                </AlertDialog.Description>
              </div>
            </div>

            <ul className="bg-muted/50 divide-border divide-y rounded-lg border text-sm">
              {(["incomes", "lines", "actuals"] as const).map((key) => (
                <li
                  key={key}
                  className={cn(
                    "flex items-center justify-between gap-3 px-3 py-2",
                    counts[key] === 0 && "text-muted-foreground",
                  )}
                >
                  <span>{t(`counts.${key}`, { count: counts[key] })}</span>
                  <span className="font-mono text-xs tabular-nums" aria-hidden>
                    {counts[key]}
                  </span>
                </li>
              ))}
            </ul>

            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("body")}{" "}
              <span className="text-foreground font-medium">{t("irreversible")}</span>
            </p>

            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                confirm();
              }}
            >
              <label htmlFor={inputId} className="flex flex-col gap-1.5 text-sm">
                <span>
                  {t.rich("typeToConfirm", {
                    month: label,
                    b: (chunks) => (
                      <strong className="bg-muted rounded px-1 py-0.5 font-semibold">
                        {chunks}
                      </strong>
                    ),
                  })}
                </span>
                <input
                  id={inputId}
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  disabled={pending}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={label}
                  aria-invalid={error || undefined}
                  className={cn(
                    "border-input bg-background placeholder:text-muted-foreground/50 rounded-md border px-3 py-2 text-base outline-none transition-colors",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
                    matches && "border-destructive/60 focus-visible:border-destructive focus-visible:ring-destructive/20",
                  )}
                />
              </label>

              {error && (
                <p role="alert" className="text-destructive flex items-center gap-1.5 text-sm">
                  <CircleAlert className="size-4 shrink-0" aria-hidden />
                  {t("error")}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <AlertDialog.Close
                  disabled={pending}
                  render={<Button type="button" variant="outline" />}
                >
                  {t("cancel")}
                </AlertDialog.Close>
                <Button
                  type="submit"
                  disabled={!matches || pending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  <Trash2 aria-hidden />
                  {pending ? t("pending") : t("confirm")}
                </Button>
              </div>
            </form>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
