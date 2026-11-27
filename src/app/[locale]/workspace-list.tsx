"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { setActiveWorkspaceAction } from "@/actions/workspaces";
import type { WorkspaceRole } from "@/lib/workspace-roles";

// ============================================================================
// Home workspace list (UC-31 §4.12, §7.1) — rendered ONLY in multi-workspace
// mode. Tapping a card makes it the active workspace (cookie + cleared
// last-opened month) and reloads Home with its months.
// ============================================================================

export interface WorkspaceCard {
  id: string;
  kind: "private" | "shared";
  name: string | null;
  role: WorkspaceRole;
}

export function WorkspaceList({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceCard[];
  activeId: string;
}) {
  const t = useTranslations("workspaces");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const select = (id: string) => {
    if (id === activeId || pending) return;
    setError(false);
    startTransition(async () => {
      const result = await setActiveWorkspaceAction({ workspaceId: id });
      if (!result.ok) {
        setError(true);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section id="workspaces" aria-labelledby="workspaces-heading" className="flex flex-col gap-2">
      <h2
        id="workspaces-heading"
        className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
      >
        {t("title")}
      </h2>
      <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((w) => {
          const active = w.id === activeId;
          const label = w.kind === "private" ? t("privateLabel") : (w.name ?? "");
          return (
            <li key={w.id}>
              <button
                type="button"
                aria-pressed={active}
                disabled={pending}
                onClick={() => select(w.id)}
                data-testid="workspace-card"
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:cursor-wait ${
                  active
                    ? "bg-accent text-accent-foreground border-primary/30"
                    : "bg-card text-card-foreground hover:bg-accent/50 cursor-pointer"
                }`}
              >
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${active ? "bg-primary" : "bg-transparent"}`}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{label}</span>
                  <span className="text-muted-foreground text-xs">
                    {w.kind === "shared" ? t("shared") : t("privateTag")}
                    {active ? ` · ${t("active")}` : ""}
                  </span>
                </span>
                {w.kind === "shared" && (
                  <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
                    {t(`roles.${w.role}`)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {tv("workspaceNotFound")}
        </p>
      )}
      <Link
        href="/workspaces#create"
        className="text-primary inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium hover:underline"
      >
        <Plus className="size-4" aria-hidden />
        {t("new")}
      </Link>
    </section>
  );
}
