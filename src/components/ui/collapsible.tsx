"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function Collapsible({
  title,
  count,
  children,
  defaultOpen = false,
  variant = "default",
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  variant?: "default" | "warning";
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const variantClasses = variant === "warning"
    ? "border-warning/30 bg-warning/5"
    : "border-border bg-card";

  return (
    <div className={`rounded-lg border ${variantClasses}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent/50"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2">
          {title}
          {count !== undefined && (
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              variant === "warning"
                ? "bg-warning/20 text-warning"
                : "bg-muted text-muted-foreground"
            }`}>
              {count}
            </span>
          )}
        </span>
        <ChevronDown
          className={`text-muted-foreground size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && <div className={`border-t px-4 py-3 ${variant === "warning" ? "border-warning/30" : "border-border"}`}>{children}</div>}
    </div>
  );
}
