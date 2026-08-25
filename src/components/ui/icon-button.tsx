import { type ReactNode } from "react";
import { Button } from "./button";
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
    <span className="group/icon-btn relative inline-flex">
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
      <span
        role="tooltip"
        className="bg-popover text-popover-foreground pointer-events-none absolute -top-9 left-1/2 z-50 -translate-x-1/2 rounded-md px-2 py-1 text-xs font-medium opacity-0 shadow-md transition-opacity group-hover/icon-btn:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
