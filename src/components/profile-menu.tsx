"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { routing, type AppLocale } from "@/i18n/routing";
import { User, LogOut, ChevronDown, Download } from "lucide-react";
import Image from "next/image";

interface ProfileMenuProps {
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  signOutAction: () => Promise<void>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function ProfileMenu({ email, displayName, avatarUrl, signOutAction }: ProfileMenuProps) {
  const t = useTranslations("profile");
  const tPwa = useTranslations("pwa");
  const current = useLocale() as AppLocale;
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState<"hidden" | "ios" | "prompt">(() => {
    if (typeof window === "undefined") return "hidden";
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return "hidden";
    const ua = window.navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
    return ios ? "ios" : "prompt";
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (installState !== "prompt") return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [installState]);

  const handleInstall = useCallback(async () => {
    if (installState === "ios") {
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallState("hidden");
    }
    setDeferredPrompt(null);
  }, [deferredPrompt, installState]);

  const handleSignOut = async () => {
    setIsOpen(false);
    await signOutAction();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted cursor-pointer"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName || email}
            width={20}
            height={20}
            className="rounded-full"
          />
        ) : (
          <User className="size-4 opacity-70" />
        )}
        <span className="hidden sm:inline max-w-32 truncate">{displayName || email}</span>
        <ChevronDown className={`size-4 opacity-70 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="bg-card border-border absolute right-0 z-50 mt-2 w-80 rounded-lg border shadow-lg">
          <div className="border-border flex flex-col gap-1 border-b p-3">
            <p className="text-sm font-medium truncate">{displayName || t("noName")}</p>
            <p className="text-muted-foreground text-xs truncate">{email}</p>
          </div>

          <div className="border-border flex flex-col gap-1 border-b p-2">
            <p className="text-muted-foreground px-2 py-1 text-xs font-medium uppercase tracking-wide">
              {t("language")}
            </p>
            {routing.locales.map((locale) => {
              const isCurrent = locale === current;
              return (
                <Link
                  key={locale}
                  href={pathname}
                  locale={locale}
                  onClick={() => setIsOpen(false)}
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${
                    isCurrent
                      ? "bg-primary text-primary-foreground font-medium"
                      : "hover:bg-muted"
                  }`}
                >
                  {t(`option.${locale}`)}
                </Link>
              );
            })}
          </div>

          {installState !== "hidden" && (
            <div className="border-border flex flex-col gap-1 border-b p-2">
              <button
                type="button"
                onClick={handleInstall}
                className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors cursor-pointer"
              >
                <Download className="size-4" />
                {installState === "ios" ? tPwa("install.iosInstructions") : tPwa("install.button")}
              </button>
            </div>
          )}

          <div className="p-2">
            <button
              type="button"
              onClick={handleSignOut}
              className="text-destructive hover:bg-destructive/10 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors cursor-pointer"
            >
              <LogOut className="size-4" />
              {t("signOut")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
