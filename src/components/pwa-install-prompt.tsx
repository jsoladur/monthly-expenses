"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

type InstallMode = "hidden" | "beforeinstallprompt" | "ios";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectInstallMode(): InstallMode {
  if (typeof window === "undefined") return "hidden";

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true;

  if (isStandalone) return "hidden";

  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;

  if (isIOS) return "ios";

  return "beforeinstallprompt";
}

export function PwaInstallPrompt() {
  const t = useTranslations("pwa");
  const [mode, setMode] = useState<InstallMode>(() => detectInstallMode());
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (mode !== "beforeinstallprompt") return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, [mode]);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setMode("hidden");
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (dismissed || mode === "hidden") return null;

  if (mode === "ios") {
    return (
      <div
        role="status"
        className="bg-card text-card-foreground flex items-start gap-3 rounded-md border p-4"
      >
        <Download className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed">
            {t("install.iosInstructions")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("offlineNote")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 shrink-0 rounded p-1 transition-colors"
          aria-label={t("install.dismiss")}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (mode === "beforeinstallprompt" && deferredPrompt) {
    return (
      <div
        role="status"
        className="bg-card text-card-foreground flex items-center gap-3 rounded-md border p-4"
      >
        <Download className="size-5 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed flex-1">
          {t("install.prompt")}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={handleInstall}>
            {t("install.button")}
          </Button>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
            aria-label={t("install.dismiss")}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
