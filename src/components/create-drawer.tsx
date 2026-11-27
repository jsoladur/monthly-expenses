"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
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

// ============================================================================
// "Create new" pattern (AGENTS.md §2, PO decision 2026-11-27): every screen
// that creates something shows a single "New …" button; its form lives in a
// mobile-first bottom sheet (the same Drawer as move-an-expense / pass to
// upcoming month). Editing stays inline.
//
// `children` receives `close`, which the form calls after a successful save
// (or is plain nodes when the form navigates away on success).
// ============================================================================

export function CreateDrawer({
  label,
  title,
  description,
  testId,
  openOnHash,
  children,
}: {
  /** Trigger button text, e.g. "New expense". */
  label: string;
  /** Drawer heading; defaults to the trigger label. */
  title?: string;
  description?: string;
  testId?: string;
  /** Opens on load (and on hash change) when the URL hash matches, e.g. "create" for `#create` links. */
  openOnHash?: string;
  /** A render function receiving `close`, or plain nodes (e.g. from an RSC) for forms that navigate away on success. */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEffect(() => {
    if (!openOnHash) return;
    const sync = () => {
      if (window.location.hash === `#${openOnHash}`) setOpen(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [openOnHash]);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={testId}
        className="h-11 self-start"
      >
        <Plus className="size-4" aria-hidden />
        {label}
      </Button>
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup>
            <DrawerContent>
              <DrawerTitle>{title ?? label}</DrawerTitle>
              {description && <DrawerDescription>{description}</DrawerDescription>}
              {open && (typeof children === "function" ? children(close) : children)}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  );
}
