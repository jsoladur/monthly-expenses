"use client";

import { useActionState, useState, useMemo } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { createMonthAction } from "@/actions/months";

interface MonthCreateFormProps {
  locale: string;
  labels: {
    year: string;
    month: string;
    submit: string;
    duplicate: string;
    validationRequired: string;
    validationMonth: string;
    validationYear: string;
  };
  monthNames: string[];
  existingMonths: Array<{ year: number; month: number }>;
}

type FormState = { ok: true } | { ok: false; error: "duplicate" | "validation" } | null;

export function MonthCreateForm({ labels, monthNames, existingMonths }: MonthCreateFormProps) {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const result = await createMonthAction({
        year: Number.parseInt(String(formData.get("year") ?? ""), 10),
        month: Number.parseInt(String(formData.get("month") ?? ""), 10),
      });
      if (result.ok) {
        router.replace(`/months/${result.year}/${result.month}`);
        return { ok: true };
      }
      return { ok: false, error: result.error };
    },
    null,
  );

  const isDuplicate = useMemo(() => {
    const y = Number.parseInt(year, 10);
    const m = Number.parseInt(month, 10);
    if (Number.isNaN(y) || Number.isNaN(m)) return false;
    return existingMonths.some((em) => em.year === y && em.month === m);
  }, [year, month, existingMonths]);

  return (
    <form action={action} className="flex flex-col gap-3" data-testid="create-month-form">
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{labels.year}</span>
          <input
            type="number"
            inputMode="numeric"
            name="year"
            required
            min={1970}
            max={9999}
            step={1}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-2 text-base"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{labels.month}</span>
          <select
            name="month"
            required
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-2 text-base"
          >
            {monthNames.map((name, index) => (
              <option key={index + 1} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button type="submit" disabled={pending || isDuplicate} size="lg">
        {labels.submit}
      </Button>
      {isDuplicate && (
        <p
          aria-live="polite"
          className="text-muted-foreground text-sm leading-relaxed"
        >
          {labels.duplicate}
        </p>
      )}
      {state && !state.ok ? (
        <p
          role="alert"
          aria-live="polite"
          className="text-destructive text-sm leading-relaxed"
        >
          {state.error === "duplicate"
            ? labels.duplicate
            : state.error === "validation"
              ? `${labels.validationRequired} ${labels.validationMonth} / ${labels.validationYear}`
              : labels.validationRequired}
        </p>
      ) : null}
    </form>
  );
}
