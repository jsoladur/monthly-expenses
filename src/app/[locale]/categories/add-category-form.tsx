"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createCategoryAction,
  type CategoryActionResult,
} from "@/actions/categories";
import { Button } from "@/components/ui/button";

// ============================================================================
// Add category form (UC-03).
//
// Uses React 19's `useActionState` so the form posts to the server action and
// the action's error code lands in component state. A successful submit
// increments a `formKey` so React remounts the form and the input clears.
// `formKey` is intentionally combined with `kind` so flipping tabs also
// gives the user a fresh input.
// ============================================================================

type Kind = "expense" | "income";

export function AddCategoryForm({
  kind,
}: {
  kind: Kind;
}) {
  const t = useTranslations("categories");
  const tv = useTranslations("validation");
  const [bumpOnSuccess, setBumpOnSuccess] = useState(0);
  const boundAction = bindKind(createCategoryAction, kind);
  const [state, formAction, pending] = useActionState<CategoryActionResult | null, FormData>(
    async (_prev, formData) => {
      const name = String(formData.get("name") ?? "").trim();
      const result = await boundAction({ name });
      if (result.ok) {
        // Bumping state from inside the action callback is the documented
        // way to react to action results in React 19; the lint rule only
        // fires for `useEffect`.
        setBumpOnSuccess((k) => k + 1);
      }
      return result;
    },
    null,
  );

  // The form's React `key` includes both the active kind and the success
  // counter so it remounts on tab flip OR after a successful add.
  const formKey = `${kind}-${bumpOnSuccess}`;

  const errorMessage = errorToMessage(state, tv);

  return (
    <form
      key={formKey}
      action={formAction}
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-stretch gap-2">
        <label htmlFor={`new-${kind}-name`} className="sr-only">
          {t(`${kind}.name`)}
        </label>
        <input
          id={`new-${kind}-name`}
          name="name"
          type="text"
          autoComplete="off"
          placeholder={t("actions.placeholder")}
          required
          maxLength={80}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 flex-1 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        />
        <Button type="submit" disabled={pending} size="default">
          {t("actions.add")}
        </Button>
      </div>
      {errorMessage && (
        <p role="alert" className="text-destructive text-xs">
          {errorMessage}
        </p>
      )}
    </form>
  );
}

// Bind the kind argument so the form only needs to ship the name in the
// FormData. Server actions accept a single serializable object — we wrap
// them so the add form stays simple.
function bindKind(
  action: (input: { kind: Kind; name: string }) => Promise<CategoryActionResult>,
  kind: Kind,
): (input: { name: string }) => Promise<CategoryActionResult> {
  return (input) => action({ kind, name: input.name });
}

function errorToMessage(
  state: CategoryActionResult | null,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case "duplicate":
      return tv("duplicateCategoryName");
    case "notFound":
      return tv("categoryNotFound");
    case "validation":
      return tv("required");
    case "alreadyInactive":
    case "alreadyActive":
      return null;
  }
}
