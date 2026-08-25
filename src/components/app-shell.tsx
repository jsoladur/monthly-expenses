"use client";

import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Calendar, Tags, Layers, Settings, Bell } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { ProfileMenu } from "./profile-menu";

interface AppShellProps {
  children: ReactNode;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  signOutAction: () => Promise<void>;
}

interface NavItem {
  href: string;
  icon: typeof Calendar;
  labelKey: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", icon: Calendar, labelKey: "home" },
  { href: "/templates", icon: Layers, labelKey: "templates" },
  { href: "/annuals", icon: Bell, labelKey: "annuals" },
  { href: "/categories", icon: Tags, labelKey: "categories" },
  { href: "/settings", icon: Settings, labelKey: "settings" },
];

function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/months/");
  }
  if (href === "/templates") {
    return pathname.startsWith("/templates");
  }
  if (href === "/annuals") {
    return pathname.startsWith("/annuals");
  }
  if (href === "/categories") {
    return pathname.startsWith("/categories");
  }
  return pathname.startsWith(href);
}

export function AppShell({ children, email, displayName, avatarUrl, signOutAction }: AppShellProps) {
  const t = useTranslations("nav");
  const tApp = useTranslations("app");
  const pathname = usePathname();

  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
          <Image
            src="/images/logo.png"
            alt={tApp("name")}
            width={32}
            height={32}
            className="rounded-lg"
          />
          <span className="text-sidebar-foreground text-lg font-semibold">
            {tApp("name")}
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActiveRoute(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="size-5 shrink-0" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 pb-20 lg:pb-0 lg:pl-60">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
          <div className="mb-4 flex justify-end">
            <ProfileMenu
              email={email}
              displayName={displayName}
              avatarUrl={avatarUrl}
              signOutAction={signOutAction}
            />
          </div>
          {children}
        </div>
      </main>

      <nav className="bg-card border-border fixed inset-x-0 bottom-0 z-50 flex border-t lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActiveRoute(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-5 shrink-0" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
