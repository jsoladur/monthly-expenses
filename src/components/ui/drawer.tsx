"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "@/lib/utils";

function Drawer(props: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ className, ...props }: DrawerPrimitive.Trigger.Props) {
  return (
    <DrawerPrimitive.Trigger data-slot="drawer-trigger" className={className} {...props} />
  );
}

function DrawerPortal(props: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerBackdrop({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DrawerPopup({ className, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.Popup
      data-slot="drawer-popup"
      className={cn(
        "bg-card text-card-foreground fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-xl border border-b-0 shadow-lg outline-none",
        className,
      )}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function DrawerViewport({ className, ...props }: DrawerPrimitive.Viewport.Props) {
  return (
    <DrawerPrimitive.Viewport
      data-slot="drawer-viewport"
      className={cn("fixed inset-0 z-50 flex items-end justify-center", className)}
      {...props}
    />
  );
}

function DrawerContent({ className, ...props }: DrawerPrimitive.Content.Props) {
  return (
    <DrawerPrimitive.Content
      data-slot="drawer-content"
      className={cn("flex flex-col gap-3 overflow-y-auto p-4 pb-8", className)}
      {...props}
    />
  );
}

function DrawerClose({ className, ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" className={className} {...props} />;
}

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerBackdrop,
  DrawerPopup,
  DrawerTitle,
  DrawerDescription,
  DrawerViewport,
  DrawerContent,
  DrawerClose,
};
