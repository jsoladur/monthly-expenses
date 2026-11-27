"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  addWorkspaceMemberAction,
  changeWorkspaceMemberRoleAction,
  deleteWorkspaceAction,
  leaveWorkspaceAction,
  removeWorkspaceMemberAction,
  renameWorkspaceAction,
  setWorkspaceCurrencyAction,
  type WorkspaceActionResult,
} from "@/actions/workspaces";
import { ASSIGNABLE_ROLES, type WorkspaceRole } from "@/lib/workspace-roles";
import { WORKSPACE_NAME_MAX, matchesWorkspaceName } from "@/lib/workspace-name";
import { workspaceErrorMessage } from "../workspace-error";

// ============================================================================
// Workspace details (UC-31 §7.2): members + role controls and add form
// (Admin+), rename + currency (Admin+), leave (non-owner), delete with typed
// name (Owner). Controls a role cannot use are not rendered (§3); the server
// re-checks every action.
// ============================================================================

interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
}

const inputClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none";

export function WorkspaceDetailsScreen({
  workspaceId,
  name,
  currency,
  currencies,
  viewerId,
  viewerRole,
  members,
  counts,
  can,
}: {
  workspaceId: string;
  name: string;
  currency: string;
  currencies: readonly string[];
  viewerId: string;
  viewerRole: WorkspaceRole;
  members: Member[];
  counts: { months: number; categories: number; templates: number; annuals: number; members: number };
  can: { manageWorkspace: boolean; manageMembers: boolean; leave: boolean; delete: boolean };
}) {
  return (
    <div className="flex flex-col gap-6">
      <MembersSection
        workspaceId={workspaceId}
        viewerId={viewerId}
        members={members}
        canManage={can.manageMembers}
      />
      {can.manageMembers && <AddMemberForm workspaceId={workspaceId} />}
      {can.manageWorkspace && (
        <SettingsSection
          workspaceId={workspaceId}
          name={name}
          currency={currency}
          currencies={currencies}
        />
      )}
      <LeaveSection workspaceId={workspaceId} name={name} canLeave={can.leave} isOwner={viewerRole === "owner"} />
      {can.delete && <DeleteSection workspaceId={workspaceId} name={name} counts={counts} />}
    </div>
  );
}

function memberLabel(m: Member): string {
  return m.displayName?.trim() ? m.displayName : m.email;
}

function MembersSection({
  workspaceId,
  viewerId,
  members,
  canManage,
}: {
  workspaceId: string;
  viewerId: string;
  members: Member[];
  canManage: boolean;
}) {
  const t = useTranslations("workspaces");
  const tv = useTranslations("validation");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<WorkspaceActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(workspaceErrorMessage(result.error, tv));
    });
  };

  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-2">
      <h2 id="members-title" className="text-lg font-semibold">
        {t("members.title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {members.map((m) => {
          const label = memberLabel(m);
          const editable = canManage && m.role !== "owner" && m.userId !== viewerId;
          return (
            <li
              key={m.userId}
              className="bg-card text-card-foreground flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {label}
                  {m.userId === viewerId ? ` (${t("members.you")})` : ""}
                </span>
                {m.displayName?.trim() && (
                  <span className="text-muted-foreground truncate text-xs">{m.email}</span>
                )}
              </span>
              {editable ? (
                <>
                  <select
                    aria-label={t("members.changeRole", { name: label })}
                    value={m.role}
                    disabled={pending}
                    onChange={(e) =>
                      run(() =>
                        changeWorkspaceMemberRoleAction({
                          workspaceId,
                          userId: m.userId,
                          role: e.target.value,
                        }),
                      )
                    }
                    className={`${inputClass} h-9`}
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </select>
                  <IconButton
                    icon={<UserMinus className="size-4" />}
                    label={t("members.remove")}
                    destructive
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(t("members.confirmRemove", { name: label }))) return;
                      run(() => removeWorkspaceMemberAction({ workspaceId, userId: m.userId }));
                    }}
                  />
                </>
              ) : (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                  {t(`roles.${m.role}`)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
        {(["admin", "editor", "reader"] as const).map((r) => (
          <li key={r}>
            <span className="font-medium">{t(`roles.${r}`)}</span>: {t(`roleHelp.${r}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddMemberForm({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("workspaces.members");
  const tr = useTranslations("workspaces.roles");
  const tv = useTranslations("validation");
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState<WorkspaceActionResult | null, FormData>(
    async (_prev, formData) => {
      const result = await addWorkspaceMemberAction({
        workspaceId,
        email: String(formData.get("email") ?? ""),
        role: String(formData.get("role") ?? "reader"),
      });
      if (result.ok) setFormKey((k) => k + 1);
      return result;
    },
    null,
  );
  return (
    <form
      key={formKey}
      action={action}
      aria-labelledby="add-member-title"
      className="bg-card text-card-foreground flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="add-member-title" className="text-lg font-semibold">
        {t("add")}
      </h2>
      <p className="text-muted-foreground text-xs leading-relaxed">{t("addHelp")}</p>
      <div className="flex flex-col gap-3 md:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">{t("email")}</span>
          <input name="email" type="email" required autoComplete="off" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("role")}</span>
          <select name="role" defaultValue="editor" className={inputClass}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {workspaceErrorMessage(state.error, tv)}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 self-start">
        {pending ? t("adding") : t("add")}
      </Button>
    </form>
  );
}

function SettingsSection({
  workspaceId,
  name,
  currency,
  currencies,
}: {
  workspaceId: string;
  name: string;
  currency: string;
  currencies: readonly string[];
}) {
  const t = useTranslations("workspaces");
  const tv = useTranslations("validation");
  const [renameState, renameAction, renamePending] = useActionState<
    WorkspaceActionResult | null,
    FormData
  >(
    (_prev, formData) =>
      renameWorkspaceAction({ workspaceId, name: String(formData.get("name") ?? "") }),
    null,
  );
  const [currencyState, currencyAction, currencyPending] = useActionState<
    WorkspaceActionResult | null,
    FormData
  >(
    (_prev, formData) =>
      setWorkspaceCurrencyAction({ workspaceId, currency: String(formData.get("currency") ?? "") }),
    null,
  );
  return (
    <section className="grid gap-4 md:grid-cols-2">
      <form action={renameAction} className="bg-card flex flex-col gap-2 rounded-lg border p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("rename.title")}</span>
          <input
            name="name"
            type="text"
            required
            defaultValue={name}
            maxLength={WORKSPACE_NAME_MAX}
            autoComplete="off"
            className={inputClass}
          />
        </label>
        <Status state={renameState} ok={t("rename.saved")} tv={tv} />
        <Button type="submit" variant="outline" disabled={renamePending} className="h-11 self-start">
          {t("rename.save")}
        </Button>
      </form>
      <form action={currencyAction} className="bg-card flex flex-col gap-2 rounded-lg border p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("currency.title")}</span>
          <select name="currency" defaultValue={currency} className={inputClass}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <Status state={currencyState} ok={t("currency.saved")} tv={tv} />
        <Button type="submit" variant="outline" disabled={currencyPending} className="h-11 self-start">
          {t("currency.save")}
        </Button>
      </form>
    </section>
  );
}

function Status({
  state,
  ok,
  tv,
}: {
  state: WorkspaceActionResult | null;
  ok: string;
  tv: ReturnType<typeof useTranslations<"validation">>;
}) {
  if (!state) return null;
  return state.ok ? (
    <p aria-live="polite" className="text-xs">
      {ok}
    </p>
  ) : (
    <p role="alert" className="text-destructive text-xs">
      {workspaceErrorMessage(state.error, tv)}
    </p>
  );
}

function LeaveSection({
  workspaceId,
  name,
  canLeave,
  isOwner,
}: {
  workspaceId: string;
  name: string;
  canLeave: boolean;
  isOwner: boolean;
}) {
  const t = useTranslations("workspaces.leave");
  const tv = useTranslations("validation");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (isOwner) {
    // UC-31 §4.5.2: the Owner cannot leave.
    return <p className="text-muted-foreground text-sm">{t("ownerBlocked")}</p>;
  }
  if (!canLeave) return null;
  return (
    <section className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        className="h-11 self-start"
        onClick={() => {
          if (!window.confirm(t("confirm", { name }))) return;
          setError(null);
          startTransition(async () => {
            const result = await leaveWorkspaceAction({ workspaceId });
            // Only reached on failure — success redirects to Home.
            if (result && !result.ok) setError(workspaceErrorMessage(result.error, tv));
          });
        }}
      >
        {t("action")}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}

function DeleteSection({
  workspaceId,
  name,
  counts,
}: {
  workspaceId: string;
  name: string;
  counts: { months: number; categories: number; templates: number; annuals: number; members: number };
}) {
  const t = useTranslations("workspaces.delete");
  const tv = useTranslations("validation");
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const matches = matchesWorkspaceName(typed, name);
  return (
    <details className="border-destructive/30 bg-card rounded-lg border">
      <summary className="text-destructive flex min-h-11 cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
        <Trash2 className="size-4" aria-hidden />
        {t("action")}
      </summary>
      <div className="flex flex-col gap-3 border-t p-4 text-sm">
        <p>{t("lead", { name })}</p>
        <ul className="text-muted-foreground list-disc pl-5">
          {(["months", "categories", "templates", "annuals", "members"] as const).map((k) => (
            <li key={k}>{t(`counts.${k}`, { count: counts[k] })}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t("irreversible")}</p>
        <label htmlFor={inputId} className="font-medium">
          {t("prompt", { name })}
        </label>
        <input
          id={inputId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="destructive"
          disabled={!matches || pending}
          className="h-11 self-start"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await deleteWorkspaceAction({ workspaceId, confirmName: typed });
              if (result && !result.ok) setError(workspaceErrorMessage(result.error, tv));
            });
          }}
        >
          {pending ? t("pending") : t("confirm")}
        </Button>
      </div>
    </details>
  );
}
