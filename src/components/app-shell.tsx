"use client";

import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  Calendar,
  History,
  Settings,
  Bell,
  Tags,
  DollarSign,
  MoreHorizontal,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { ProfileMenu } from "./profile-menu";
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
} from "@/components/ui/drawer";

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
  testId: string;
}

const DESKTOP_ITEMS: NavItem[] = [
  { href: "/", icon: Calendar, labelKey: "home", testId: "nav-home" },
  { href: "/stats", icon: BarChart3, labelKey: "stats", testId: "nav-stats" },
  { href: "/templates", icon: DollarSign, labelKey: "templates", testId: "nav-templates" },
  { href: "/annuals", icon: Bell, labelKey: "annuals", testId: "nav-annuals" },
  { href: "/categories", icon: Tags, labelKey: "categories", testId: "nav-categories" },
  { href: "/history", icon: History, labelKey: "history", testId: "nav-history" },
  { href: "/settings", icon: Settings, labelKey: "settings", testId: "nav-settings" },
];

const MOBILE_PRIMARY: NavItem[] = [
  { href: "/", icon: Calendar, labelKey: "home", testId: "nav-home" },
  { href: "/stats", icon: BarChart3, labelKey: "stats", testId: "nav-stats" },
  { href: "/templates", icon: DollarSign, labelKey: "templates", testId: "nav-templates" },
];

const MORE_ITEMS: NavItem[] = [
  { href: "/annuals", icon: Bell, labelKey: "annuals", testId: "nav-annuals" },
  { href: "/categories", icon: Tags, labelKey: "categories", testId: "nav-categories" },
  { href: "/history", icon: History, labelKey: "history", testId: "nav-history" },
];

const MOBILE_SETTINGS: NavItem = {
  href: "/settings",
  icon: Settings,
  labelKey: "settings",
  testId: "nav-settings",
};

function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/months/");
  }
  return pathname.startsWith(href);
}

function isMoreActive(pathname: string): boolean {
  return MORE_ITEMS.some((item) => isActiveRoute(pathname, item.href));
}

function navClass(active: boolean, extra = ""): string {
  return `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
    active
      ? "bg-sidebar-accent text-sidebar-primary"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
  } ${extra}`;
}

function mobileItemClass(active: boolean): string {
  return `flex min-h-11 flex-1 flex-col items-center justify-center gap-1 py-3 text-xs font-medium transition-colors ${
    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
  }`;
}

export function AppShell({ children, email, displayName, avatarUrl, signOutAction }: AppShellProps) {
  const t = useTranslations("nav");
  const tApp = useTranslations("app");
  const pathname = usePathname();
  const wide = pathname.startsWith("/stats");

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
          {DESKTOP_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActiveRoute(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                className={navClass(active)}
              >
                <Icon className="size-5 shrink-0" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 pb-20 lg:pb-0 lg:pl-60">
        <div className={`mx-auto w-full px-4 py-6 md:px-6 md:py-8 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
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

      <nav
        className="bg-card border-border fixed inset-x-0 bottom-0 z-50 flex border-t lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="mobile-nav"
      >
        {MOBILE_PRIMARY.map((item) => {
          const Icon = item.icon;
          const active = isActiveRoute(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={item.testId}
              className={mobileItemClass(active)}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-5 shrink-0" />
              {t(item.labelKey)}
            </Link>
          );
        })}
        <Drawer>
          <DrawerTrigger
            data-testid="nav-more"
            className={mobileItemClass(isMoreActive(pathname))}
            aria-current={isMoreActive(pathname) ? "page" : undefined}
          >
            <MoreHorizontal className="size-5 shrink-0" />
            {t("more")}
          </DrawerTrigger>
          <DrawerPortal>
            <DrawerBackdrop />
            <DrawerViewport>
              <DrawerPopup>
                <DrawerContent>
                  <DrawerTitle>{t("more")}</DrawerTitle>
                  <ul className="flex flex-col gap-1">
                    {MORE_ITEMS.map((item) => {
                      const Icon = item.icon;
                      const active = isActiveRoute(pathname, item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            data-testid={`${item.testId}-more`}
                            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                              active
                                ? "bg-accent text-accent-foreground"
                                : "text-foreground hover:bg-accent/50"
                            }`}
                          >
                            <Icon className="size-5 shrink-0" />
                            {t(item.labelKey)}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </DrawerContent>
              </DrawerPopup>
            </DrawerViewport>
          </DrawerPortal>
        </Drawer>
        <Link
          href={MOBILE_SETTINGS.href}
          data-testid={MOBILE_SETTINGS.testId}
          className={mobileItemClass(isActiveRoute(pathname, MOBILE_SETTINGS.href))}
          aria-current={isActiveRoute(pathname, MOBILE_SETTINGS.href) ? "page" : undefined}
        >
          <Settings className="size-5 shrink-0" />
          {t("settings")}
        </Link>
      </nav>
    </div>
  );
}
