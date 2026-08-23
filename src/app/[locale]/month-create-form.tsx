"use client";

import { useActionState, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { createMonthAction } from "@/actions/months";

// ============================================================================
// Create-month form — UC-06 client island.
//
// Wraps the server action with `useActionState` so duplicate / validation
// errors render inline (PRD §11). On success the action also sets the
// `last_opened_month` cookie and revalidates the home — we then navigate
// straight into the workspace so the user sees the cloned reserved lines
// (PRD C17, §7.8).
//
// Year + month are stored as plain text in state (rather than pre-coerced
// numbers) so the user can erase and retype without the form snapping back.
// The server action runs the Zod `yearSchema` / `monthSchema` which require
// integers in 1970..9999 / 1..12.
// ============================================================================

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
}

type FormState = { ok: true } | { ok: false; error: "duplicate" | "validation" } | null;

export function MonthCreateForm({ labels }: MonthCreateFormProps) {
  const router = useRouter();
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
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
          <input
            type="number"
            inputMode="numeric"
            name="month"
            required
            min={1}
            max={12}
            step={1}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-2 text-base"
            autoComplete="off"
          />
        </label>
      </div>
      <Button type="submit" disabled={pending} size="lg">
        {labels.submit}
      </Button>
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
