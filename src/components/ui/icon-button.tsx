"use client";

import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTip({ top: rect.top - 8, left: rect.left + rect.width / 2 });
  };

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
      onFocus={show}
      onBlur={() => setTip(null)}
    >
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
      {tip &&
        createPortal(
          <span
            role="tooltip"
            className="bg-popover text-popover-foreground pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap shadow-md"
            style={{ top: tip.top, left: tip.left }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
