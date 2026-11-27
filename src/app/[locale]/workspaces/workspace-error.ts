import type { useTranslations } from "next-intl";
import type { WorkspaceActionError } from "@/actions/workspaces";

/** Workspace action error codes → `validation.*` copy (UC-31 §8). */
export function workspaceErrorMessage(
  error: WorkspaceActionError,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string {
  switch (error) {
    case "validation":
      return tv("required");
    case "currencyInvalid":
      return tv("currencyInvalid");
    default:
      return tv(error);
  }
}
