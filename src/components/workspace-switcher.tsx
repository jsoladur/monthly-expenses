"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Menu } from "@base-ui/react/menu";
import { Separator } from "@base-ui/react/separator";
import { Check, ChevronDown, Plus, Settings2 } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { setActiveWorkspaceAction } from "@/actions/workspaces";
import type { WorkspaceRole } from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";

// ============================================================================
// Header workspace switcher (UC-31 §4.12, PO decision 2026-11-27): the one
// place to pick the active workspace, shown only with more than one
// workspace. Picking one sets the `active_workspace` cookie (and clears the
// last-opened month) through `setActiveWorkspaceAction`, then refreshes the
// current screen — or goes Home from a month, which belongs to the previous
// workspace.
// ============================================================================

export interface SwitcherWorkspace {
  id: string;
  kind: "private" | "shared";
  name: string | null;
  role: WorkspaceRole;
  /** UC-32: an ownership offer to the viewer waits in this workspace. */
  ownershipOffered?: boolean;
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  tone,
}: {
  workspaces: SwitcherWorkspace[];
  activeId: string;
  /** `bar`: navy mobile top bar; `page`: desktop content header. */
  tone: "bar" | "page";
}) {
  const t = useTranslations("workspaces");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const label = (w: SwitcherWorkspace) =>
    w.kind === "private" ? t("privateLabel") : (w.name ?? "");
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0]!;

  const select = (id: string) => {
    if (id === activeId || pending) return;
    startTransition(async () => {
      const result = await setActiveWorkspaceAction({ workspaceId: id });
      if (!result.ok) return;
      if (pathname.startsWith("/months/")) router.replace("/");
      else router.refresh();
    });
  };

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("switcher.open", { name: label(active) })}
        data-testid="workspace-switcher"
        disabled={pending}
        className={cn(
          "focus-visible:ring-ring/50 inline-flex min-h-11 min-w-0 cursor-pointer items-center gap-1 rounded-full px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 disabled:cursor-wait",
          // In the phone top bar the name must truncate before it reaches the
          // profile button; on desktop there is room for a longer name.
          tone === "bar"
            ? "text-sidebar-foreground/90 hover:bg-sidebar-accent/40 data-popup-open:bg-sidebar-accent/40 max-w-[42vw]"
            : "text-foreground bg-card hover:bg-accent data-popup-open:bg-accent max-w-[14rem] border",
        )}
      >
        <span className="truncate">{label(active)}</span>
        {workspaces.some((w) => w.ownershipOffered) && (
          <span
            className="bg-one-off size-2 shrink-0 rounded-full"
            aria-label={t("transfer.incomingBadge")}
            data-testid="switcher-offer-dot"
          />
        )}
        <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="z-50 outline-none"
          side="bottom"
          align={tone === "bar" ? "end" : "start"}
          sideOffset={6}
        >
          <Menu.Popup className="bg-popover text-popover-foreground w-72 max-w-[calc(100vw-1rem)] origin-(--transform-origin) rounded-lg border p-1 shadow-lg outline-none transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className="text-muted-foreground px-2.5 py-1.5 text-xs font-semibold tracking-wide uppercase">
                {t("title")}
              </Menu.GroupLabel>
              <Menu.RadioGroup value={activeId} onValueChange={(v) => select(String(v))}>
                {workspaces.map((w) => (
                  <Menu.RadioItem
                    key={w.id}
                    value={w.id}
                    closeOnClick
                    data-testid="workspace-option"
                    className="data-highlighted:bg-accent flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <Menu.RadioItemIndicator>
                        <Check className="size-4" aria-hidden />
                      </Menu.RadioItemIndicator>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{label(w)}</span>
                      <span className="text-muted-foreground text-xs">
                        {w.kind === "shared"
                          ? `${t("shared")} · ${t(`roles.${w.role}`)}`
                          : t("privateTag")}
                      </span>
                      {w.ownershipOffered && (
                        <span className="text-one-off text-xs font-medium">
                          {t("transfer.incomingBadge")}
                        </span>
                      )}
                    </span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <Separator className="bg-border my-1 h-px" />
            <Menu.Item
              onClick={() => router.push("/workspaces")}
              className="data-highlighted:bg-accent flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none"
            >
              <Settings2 className="size-4" aria-hidden />
              {t("switcher.manage")}
            </Menu.Item>
            <Menu.Item
              onClick={() => router.push("/workspaces#create")}
              className="data-highlighted:bg-accent flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none"
            >
              <Plus className="size-4" aria-hidden />
              {t("new")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
