"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  createSharedWorkspaceAction,
  type CreateWorkspaceResult,
} from "@/actions/workspaces";
import { WORKSPACE_NAME_MAX } from "@/lib/workspace-name";
import { workspaceErrorMessage } from "./workspace-error";

// UC-31 §4.2 / §7.2: name (1–60) + currency, pre-selected from the user's
// profile currency. On success, open the new workspace's details to add
// members.
export function CreateWorkspaceForm({
  defaultCurrency,
  currencies,
}: {
  defaultCurrency: string;
  currencies: readonly string[];
}) {
  const t = useTranslations("workspaces.create");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [currency, setCurrency] = useState(defaultCurrency);
  const [state, action, pending] = useActionState<CreateWorkspaceResult | null, FormData>(
    async (_prev, formData) => {
      const result = await createSharedWorkspaceAction({
        name: String(formData.get("name") ?? ""),
        currency: String(formData.get("currency") ?? ""),
      });
      if (result.ok) router.push(`/workspaces/${result.workspaceId}`);
      return result;
    },
    null,
  );

  return (
    <form action={action} aria-label={t("title")} className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm leading-relaxed">{t("help")}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("name")}</span>
        <input
          name="name"
          type="text"
          required
          maxLength={WORKSPACE_NAME_MAX}
          autoComplete="off"
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("currency")}</span>
        <select
          name="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {workspaceErrorMessage(state.error, tv)}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 self-start">
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
