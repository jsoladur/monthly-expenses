"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateDrawer } from "@/components/create-drawer";
import {
  acceptOwnershipTransferAction,
  cancelOwnershipTransferAction,
  declineOwnershipTransferAction,
  proposeOwnershipTransferAction,
  type TransferActionError,
} from "@/actions/workspace-transfer";
import type { WorkspaceRole } from "@/lib/workspace-roles";

// ============================================================================
// Ownership transfer (UC-32 §5) on the workspace details screen.
//
//   - OwnershipSection: the Owner offers ownership to a member (bottom sheet,
//     AGENTS.md "create new" pattern), or sees the pending offer and cancels.
//   - OwnershipOfferBanner: the addressee accepts (with an inline
//     confirmation) or declines.
// Nobody becomes Owner without accepting; the server re-checks everything.
// ============================================================================

export interface OfferView {
  fromUserId: string;
  fromLabel: string;
  toUserId: string;
  toLabel: string;
}

export interface TransferCandidate {
  userId: string;
  label: string;
  email: string;
  role: WorkspaceRole;
}

function useErrorText() {
  const tv = useTranslations("validation");
  return (code: TransferActionError) =>
    code === "validation" ? tv("required") : tv(code);
}

export function OwnershipSection({
  workspaceId,
  offer,
  candidates,
}: {
  workspaceId: string;
  offer: OfferView | null;
  candidates: TransferCandidate[];
}) {
  const t = useTranslations("workspaces.transfer");
  const errorText = useErrorText();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="ownership-title" className="flex flex-col gap-2">
      <h2 id="ownership-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {offer ? (
        <div className="bg-card flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3">
          <Crown className="text-one-off size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">{t("pending", { name: offer.toLabel })}</p>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            className="h-11"
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await cancelOwnershipTransferAction({ workspaceId });
                if (!result.ok) setError(errorText(result.error));
              });
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      ) : candidates.length === 0 ? (
        // Nothing to offer yet: the hint stays inline (AGENTS.md §2).
        <p className="text-muted-foreground text-sm">{t("noCandidates")}</p>
      ) : (
        <CreateDrawer
          label={t("button")}
          testId="transfer-ownership"
          icon={<Crown className="size-4" aria-hidden />}
        >
          {(close) => (
            <OfferForm workspaceId={workspaceId} candidates={candidates} onOffered={close} />
          )}
        </CreateDrawer>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}

function OfferForm({
  workspaceId,
  candidates,
  onOffered,
}: {
  workspaceId: string;
  candidates: TransferCandidate[];
  onOffered: () => void;
}) {
  const t = useTranslations("workspaces.transfer");
  const tr = useTranslations("workspaces.roles");
  const errorText = useErrorText();
  const [toUserId, setToUserId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={t("button")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!toUserId) return;
        setError(null);
        startTransition(async () => {
          const result = await proposeOwnershipTransferAction({ workspaceId, toUserId });
          if (result.ok) onOffered();
          else setError(errorText(result.error));
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("pick")}</span>
        <select
          required
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 rounded-md border px-3 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        >
          <option value="" disabled>
            {t("choose")}
          </option>
          {candidates.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.label === c.email ? c.email : `${c.label} · ${c.email}`} ({tr(c.role)})
            </option>
          ))}
        </select>
      </label>
      <p className="bg-muted/50 rounded-md px-3 py-2 text-sm leading-relaxed">{t("afterAccept")}</p>
      <p className="text-muted-foreground text-xs">{t("waitsInApp")}</p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending || !toUserId} className="h-11 self-start">
        {t("confirmOffer")}
      </Button>
    </form>
  );
}

export function OwnershipOfferBanner({
  workspaceId,
  workspaceName,
  offer,
  onAccepted,
}: {
  workspaceId: string;
  workspaceName: string;
  offer: OfferView;
  onAccepted: () => void;
}) {
  const t = useTranslations("workspaces.transfer");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => ReturnType<typeof acceptOwnershipTransferAction>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) after?.();
      else setError(errorText(result.error));
    });
  };

  return (
    <section
      aria-labelledby="ownership-offer-title"
      data-testid="ownership-offer"
      className="bg-secondary text-secondary-foreground border-one-off/40 flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="bg-one-off/15 text-one-off flex size-10 shrink-0 items-center justify-center rounded-full"
        >
          <Crown className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="ownership-offer-title" className="text-base font-semibold">
            {t("incomingBanner", { owner: offer.fromLabel, workspace: workspaceName })}
          </h2>
          <p className="text-muted-foreground text-xs">{t("waitsInApp")}</p>
        </div>
      </div>
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed">{t("acceptConfirm", { owner: offer.fromLabel })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              className="h-11"
              onClick={() => act(() => acceptOwnershipTransferAction({ workspaceId }), onAccepted)}
            >
              {t("confirmAccept")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              className="h-11"
              onClick={() => setConfirming(false)}
            >
              {tc("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} className="h-11" onClick={() => setConfirming(true)}>
            {t("accept")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            className="h-11"
            onClick={() => act(() => declineOwnershipTransferAction({ workspaceId }))}
          >
            {t("decline")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
