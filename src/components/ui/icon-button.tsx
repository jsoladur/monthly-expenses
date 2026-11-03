"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { HoverTooltip } from "./hover-tooltip";
import { cn } from "@/lib/utils";

export function IconButton({
  icon,
  label,
  variant = "ghost",
  destructive = false,
  className,
  ...props
}: {
  icon: ReactNode;
  label: string;
  variant?: "ghost" | "default" | "outline" | "secondary" | "destructive";
  destructive?: boolean;
} & Omit<React.ComponentProps<typeof Button>, "children" | "title">) {
  return (
    <HoverTooltip label={label}>
      <Button
        type="button"
        variant={variant}
        size="icon-sm"
        title={label}
        className={cn(
          "cursor-pointer",
          destructive && "hover:text-destructive",
          className,
        )}
        {...props}
      >
        {icon}
      </Button>
    </HoverTooltip>
  );
}
