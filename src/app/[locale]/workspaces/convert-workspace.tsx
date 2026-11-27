"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Download, Lock, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from "@/components/ui/drawer";
import { downloadBase64Xlsx } from "@/components/export-expenses-drawer";
import { exportExpensesAction } from "@/actions/export";
import {
  makeWorkspaceMyPrivateAction,
  shareMyPrivateWorkspaceAction,
} from "@/actions/workspaces";
import { useRouter } from "@/i18n/navigation";
import type { WorkspaceRole } from "@/lib/workspace-roles";
import { WORKSPACE_NAME_MAX, matchesWorkspaceName } from "@/lib/workspace-name";
import { workspaceErrorMessage } from "./workspace-error";

// ============================================================================
// Convert private ↔ shared (UC-33 §3, §5).
//
//   - ShareWorkspaceFlow: two confirmations (explain + name, typed name).
//   - MakePrivateFlow: three confirmations (what you lose, who loses access +
//     acknowledgement, typed name).
//
// A bottom sheet (the AGENTS.md §2 Drawer), one step per screen, Back and
// Cancel on every step; cancelling at any step changes nothing. The steps are
// mounted only while open, so re-opening always starts at step 1. The server
// re-checks every confirmation.
// ============================================================================

export interface ConversionCounts {
  months: number;
  categories: number;
  templates: number;
  annuals: number;
  actuals: number;
}

const COUNT_KEYS = ["months", "categories", "templates", "annuals", "actuals"] as const;

const inputClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none";

const bold = (chunks: ReactNode) => <strong className="font-semibold">{chunks}</strong>;

function isEmpty(counts: ConversionCounts): boolean {
  return COUNT_KEYS.every((k) => counts[k] === 0);
}

// ----------------------------------------------------------------------------
// Shared building blocks
// ----------------------------------------------------------------------------

function StepSheet({
  trigger,
  title,
  description,
  children,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {trigger(() => setOpen(true))}
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup>
            <DrawerContent>
              <DrawerTitle>{title}</DrawerTitle>
              {description && <DrawerDescription>{description}</DrawerDescription>}
              {open && children(() => setOpen(false))}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  const t = useTranslations("workspaces.convert.share");
  return (
    <div className="flex items-center gap-3">
      <ol aria-hidden className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <li
            key={i}
            className={`h-1.5 w-6 rounded-full transition-colors ${
              i < current ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </ol>
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {t("step", { current, total })}
      </p>
    </div>
  );
}

function StepActions({
  onBack,
  onCancel,
  children,
}: {
  onBack?: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("workspaces.convert");
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {children}
      {onBack && (
        <Button type="button" variant="outline" className="h-11" onClick={onBack}>
          {t("back")}
        </Button>
      )}
      <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
        {t("cancel")}
      </Button>
    </div>
  );
}

function CountList({
  counts,
  ns,
}: {
  counts: ConversionCounts;
  ns: "workspaces.convert.share.counts" | "workspaces.convert.private.step1.counts";
}) {
  const t = useTranslations(ns);
  return (
    <ul className="bg-muted/40 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md px-3 py-2 text-sm">
      {COUNT_KEYS.map((k) => (
        <li key={k} className={counts[k] === 0 ? "text-muted-foreground" : undefined}>
          {t(k, { count: counts[k] })}
        </li>
      ))}
    </ul>
  );
}

function TypedName({
  prompt,
  label,
  value,
  onChange,
}: {
  prompt: ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{prompt}</p>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className={inputClass}
        aria-label={label}
      />
    </div>
  );
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  );
}

// ----------------------------------------------------------------------------
// Share my private workspace (§3.1)
// ----------------------------------------------------------------------------

export function ShareWorkspaceFlow({
  workspaceId,
  counts,
}: {
  workspaceId: string;
  counts: ConversionCounts;
}) {
  const t = useTranslations("workspaces.convert.share");
  return (
    <StepSheet
      title={t("title")}
      trigger={(open) => (
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0"
          data-testid="share-private-workspace"
          onClick={open}
        >
          <Share2 className="size-4" aria-hidden />
          {t("action")}
        </Button>
      )}
    >
      {(close) => <ShareSteps workspaceId={workspaceId} counts={counts} onCancel={close} />}
    </StepSheet>
  );
}

function ShareSteps({
  workspaceId,
  counts,
  onCancel,
}: {
  workspaceId: string;
  counts: ConversionCounts;
  onCancel: () => void;
}) {
  const t = useTranslations("workspaces.convert.share");
  const tv = useTranslations("validation");
  const router = useRouter();
  const nameId = useId();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cleanName = name.trim().replace(/\s+/g, " ");
  const nameValid = cleanName.length > 0 && cleanName.length <= WORKSPACE_NAME_MAX;

  if (step === 1) {
    return (
      <form
        className="flex flex-col gap-4"
        aria-label={t("title")}
        onSubmit={(e) => {
          e.preventDefault();
          if (nameValid) setStep(2);
        }}
      >
        <StepIndicator current={1} total={2} />
        <p className="text-sm leading-relaxed">{t("explain")}</p>
        {isEmpty(counts) ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground text-xs">{t("countsLead")}</p>
            <CountList counts={counts} ns="workspaces.convert.share.counts" />
          </div>
        )}
        <label htmlFor={nameId} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("nameLabel")}</span>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={WORKSPACE_NAME_MAX}
            autoComplete="off"
            className={inputClass}
          />
          <span className="text-muted-foreground text-xs">{t("nameHelp")}</span>
        </label>
        <StepActions onCancel={onCancel}>
          <Button type="submit" className="h-11" disabled={!nameValid}>
            {t("continue")}
          </Button>
        </StepActions>
      </form>
    );
  }

  const matches = matchesWorkspaceName(typed, cleanName);
  return (
    <form
      className="flex flex-col gap-4"
      aria-label={t("title")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!matches) return;
        setError(null);
        startTransition(async () => {
          const result = await shareMyPrivateWorkspaceAction({
            workspaceId,
            name: cleanName,
            confirmName: typed,
          });
          if (result.ok) router.push(`/workspaces/${result.workspaceId}?shared=1`);
          else setError(workspaceErrorMessage(result.error, tv));
        });
      }}
    >
      <StepIndicator current={2} total={2} />
      <TypedName
        prompt={t.rich("typePrompt", { name: cleanName, b: bold })}
        label={t("typeLabel")}
        value={typed}
        onChange={setTyped}
      />
      <ErrorText error={error} />
      <StepActions onBack={() => setStep(1)} onCancel={onCancel}>
        <Button type="submit" className="h-11" disabled={!matches || pending}>
          {pending ? t("pending") : t("confirm")}
        </Button>
      </StepActions>
    </form>
  );
}

// ----------------------------------------------------------------------------
// Make this shared workspace my private workspace (§3.2)
// ----------------------------------------------------------------------------

export interface LosingMember {
  userId: string;
  label: string;
  email: string;
  role: WorkspaceRole;
}

export interface MakePrivateView {
  privateWorkspaceId: string | null;
  privateCounts: ConversionCounts;
  members: LosingMember[];
  invitations: { email: string; role: WorkspaceRole }[];
}

export function MakePrivateFlow({
  workspaceId,
  name,
  view,
}: {
  workspaceId: string;
  name: string;
  view: MakePrivateView;
}) {
  const t = useTranslations("workspaces.convert.private");
  return (
    <StepSheet
      title={t("title")}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          data-testid="make-private-workspace"
          className="text-destructive hover:bg-destructive/5 focus-visible:ring-ring/50 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:outline-none"
        >
          <Lock className="size-4" aria-hidden />
          {t("action")}
        </button>
      )}
    >
      {(close) => (
        <MakePrivateSteps workspaceId={workspaceId} name={name} view={view} onCancel={close} />
      )}
    </StepSheet>
  );
}

function MakePrivateSteps({
  workspaceId,
  name,
  view,
  onCancel,
}: {
  workspaceId: string;
  name: string;
  view: MakePrivateView;
  onCancel: () => void;
}) {
  const t = useTranslations("workspaces.convert.private");
  const tc = useTranslations("workspaces.convert");
  const tr = useTranslations("workspaces.roles");
  const tv = useTranslations("validation");
  const checkId = useId();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (step === 1) {
    return (
      <div className="flex flex-col gap-4">
        <StepIndicator current={1} total={3} />
        <p className="text-sm leading-relaxed">{t.rich("step1.lead", { name, b: bold })}</p>
        {isEmpty(view.privateCounts) ? (
          <p className="text-muted-foreground text-sm">{t("step1.empty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">{t("step1.countsLead")}</p>
            <CountList counts={view.privateCounts} ns="workspaces.convert.private.step1.counts" />
            {view.privateWorkspaceId && <ExportPrivateButton workspaceId={view.privateWorkspaceId} />}
          </div>
        )}
        <StepActions onCancel={onCancel}>
          <Button type="button" className="h-11" onClick={() => setStep(2)}>
            {tc("continue")}
          </Button>
        </StepActions>
      </div>
    );
  }

  if (step === 2) {
    const nobody = view.members.length === 0 && view.invitations.length === 0;
    return (
      <div className="flex flex-col gap-4">
        <StepIndicator current={2} total={3} />
        {nobody ? (
          <p className="text-muted-foreground text-sm">{t("step2.none")}</p>
        ) : (
          <>
            <p className="text-sm leading-relaxed">{t("step2.lead")}</p>
            {view.members.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-muted-foreground text-xs">{t("step2.membersList")}</h3>
                <ul className="flex flex-col divide-y rounded-md border text-sm">
                  {view.members.map((m) => (
                    <li key={m.userId} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                      <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
                        {tr(m.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {view.invitations.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-muted-foreground text-xs">{t("step2.invitationsList")}</h3>
                <ul className="flex flex-col divide-y rounded-md border border-dashed text-sm">
                  {view.invitations.map((i) => (
                    <li key={i.email} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{i.email}</span>
                      <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
                        {tr(i.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <label
          htmlFor={checkId}
          className="border-destructive/30 bg-destructive/5 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm"
        >
          <input
            id={checkId}
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="accent-destructive mt-0.5 size-4 shrink-0"
          />
          <span>{t("step2.acknowledge")}</span>
        </label>
        <StepActions onBack={() => setStep(1)} onCancel={onCancel}>
          <Button type="button" className="h-11" disabled={!acknowledged} onClick={() => setStep(3)}>
            {tc("continue")}
          </Button>
        </StepActions>
      </div>
    );
  }

  const matches = matchesWorkspaceName(typed, name);
  return (
    <form
      className="flex flex-col gap-4"
      aria-label={t("title")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!matches || !acknowledged) return;
        setError(null);
        startTransition(async () => {
          const result = await makeWorkspaceMyPrivateAction({
            workspaceId,
            confirmName: typed,
            acknowledgeDataLoss: acknowledged,
          });
          // Only reached on failure — success redirects Home.
          if (result && !result.ok) setError(workspaceErrorMessage(result.error, tv));
        });
      }}
    >
      <StepIndicator current={3} total={3} />
      <TypedName
        prompt={t.rich("step3.typePrompt", { name, b: bold })}
        label={t("step3.typeLabel")}
        value={typed}
        onChange={setTyped}
      />
      <ErrorText error={error} />
      <StepActions onBack={() => setStep(2)} onCancel={onCancel}>
        <Button type="submit" variant="destructive" className="h-11" disabled={!matches || pending}>
          {pending ? t("step3.pending") : t("step3.confirm")}
        </Button>
      </StepActions>
    </form>
  );
}

/** Optional UC-19 export of the private workspace that is about to go (§3.2 step 1). */
function ExportPrivateButton({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("workspaces.convert.private.step1");
  const tv = useTranslations("validation");
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "done" | string>("idle");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={pending}
        onClick={() => {
          setStatus("idle");
          startTransition(async () => {
            const result = await exportExpensesAction({ mode: "all", workspaceId });
            if (result.ok) {
              downloadBase64Xlsx(result.filename, result.base64);
              setStatus("done");
            } else {
              setStatus(result.error === "validation" ? tv("required") : tv(result.error));
            }
          });
        }}
      >
        <Download className="size-4" aria-hidden />
        {pending ? t("exporting") : t("export")}
      </Button>
      {status === "done" ? (
        <span aria-live="polite" className="text-muted-foreground text-xs">
          {t("exported")}
        </span>
      ) : status !== "idle" ? (
        <span role="alert" className="text-destructive text-xs">
          {status}
        </span>
      ) : null}
    </div>
  );
}
