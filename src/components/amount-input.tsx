"use client";

import { useId, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { classifyAmount, normalizeAmount, type AmountValidity } from "@/components/amount-input-helpers";

// ============================================================================
// Amount input (UC-02, PRD C9, PRD §11, ADR-5, ARCH §8).
//
// The amount format is fixed: `^-?\d{1,12}\.\d{2}$`, dot decimal in BOTH
// locales (`1234.56`, NOT `1234,56`). The locale only changes the display
// copy and the grouping separators elsewhere — never the input format.
//
// The component is fully controlled (`value` + `onChange`). Server actions
// receive the string and validate via `amountSchema` (Zod) so this client
// check is a UX hint, not the security boundary.
// ============================================================================

interface AmountInputProps {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputClassName?: string;
}

export function AmountInput({
  value,
  onChange,
  id,
  name,
  required = false,
  disabled = false,
  autoComplete,
  placeholder = "1234.56",
  ariaLabel,
  inputClassName,
}: AmountInputProps) {
  const t = useTranslations("validation");
  const errorId = useId();
  const [touched, setTouched] = useState(false);
  const validity: AmountValidity = classifyAmount(value, required);
  const showError = touched && validity === "invalid";
  const showHint = touched && validity === "incomplete";

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        inputMode="decimal"
        id={id}
        autoComplete={autoComplete}
        name={name}
        value={value}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={showError || undefined}
        aria-describedby={showError || showHint ? errorId : undefined}
        onChange={handleChange}
        onBlur={() => {
          setTouched(true);
          const normalized = normalizeAmount(value);
          if (normalized !== value) {
            onChange(normalized);
          }
        }}
        className={
          "border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-3 focus-visible:outline-none aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:pointer-events-none disabled:opacity-50 " +
          (inputClassName ?? "")
        }
      />
      {(showError || showHint) && (
        <p
          id={errorId}
          role={showError ? "alert" : undefined}
          className={
            showError ? "text-destructive text-xs" : "text-muted-foreground text-xs"
          }
        >
          {t("amountFormat")}
        </p>
      )}
    </div>
  );
}
