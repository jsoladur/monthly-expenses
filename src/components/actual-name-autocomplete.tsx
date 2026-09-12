"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  filterNameSuggestions,
  type ActualNameSuggestion,
} from "@/lib/actual-name-suggestions";

// ============================================================================
// Add-actual name combobox (UC-17, PRD UC-22 / C13).
//
// Uncontrolled input so Playwright `fill` and native FormData keep working
// (existing UC-08 e2e). Query state only drives the prefix list. Inline list
// (not overlay) so it stays attached to the field above a phone keyboard.
// ============================================================================

export function ActualNameAutocomplete({
  id,
  name,
  suggestions,
  placeholder,
  required,
  maxLength,
  className,
}: {
  id: string;
  name: string;
  suggestions: ActualNameSuggestion[];
  placeholder: string;
  required?: boolean;
  maxLength?: number;
  className?: string;
}) {
  const t = useTranslations("actuals.autocomplete");
  const listboxId = useId();
  const liveId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const matches = filterNameSuggestions(suggestions, query);
  const listOpen = open && matches.length > 0;
  const activeOptionId =
    listOpen && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  const syncQuery = (next: string) => {
    setQuery(next);
    setOpen(true);
    setActiveIndex(-1);
  };

  const pick = (item: ActualNameSuggestion) => {
    if (inputRef.current) inputRef.current.value = item.name;
    setQuery(item.name);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (listOpen) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      if (matches.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (!listOpen || current < 0) return 0;
        return (current + 1) % matches.length;
      });
      return;
    }
    if (event.key === "ArrowUp") {
      if (!listOpen) return;
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? matches.length - 1 : current - 1,
      );
      return;
    }
    if (event.key === "Enter" && listOpen && activeIndex >= 0) {
      event.preventDefault();
      const item = matches[activeIndex];
      if (item) pick(item);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        aria-describedby={liveId}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        onChange={(event) => syncQuery(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        className={cn(
          "border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none",
          className,
        )}
      />
      <span id={liveId} className="sr-only" aria-live="polite">
        {listOpen ? t("a11y.suggestions", { count: matches.length }) : ""}
      </span>
      {listOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t("listLabel")}
          className="border-border bg-card mt-1 flex flex-col overflow-hidden rounded-[var(--radius)] border"
        >
          {matches.map((item, index) => {
            const selected = index === activeIndex;
            return (
              <li key={`${item.name}-${item.year}-${item.month}`} role="presentation">
                <button
                  type="button"
                  id={`${listboxId}-opt-${index}`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  className={cn(
                    "h-11 w-full truncate px-3 text-left text-sm text-foreground",
                    "focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none",
                    selected ? "bg-secondary text-secondary-foreground" : "bg-card",
                  )}
                  onPointerDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => pick(item)}
                >
                  {item.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
