"use client";

import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  Calendar,
  History,
  Search,
  Settings,
  Bell,
  Tags,
  DollarSign,
  MoreHorizontal,
  Users,
  ChevronDown,
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

export interface AppShellProps {
  children: ReactNode;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  signOutAction: () => Promise<void>;
}

/**
 * UC-31 §4.12: the header switcher chip, only in multi-workspace mode. `null`
 * (single-workspace mode) hides it. The Workspaces nav entry is always there
 * (PO decision 2026-11-27).
 */
export interface WorkspaceSwitcherInfo {
  activeName: string;
}

interface NavItem {
  href: string;
  icon: typeof Calendar;
  labelKey: string;
  testId: string;
}

const WORKSPACES_ITEM: NavItem = {
  href: "/workspaces",
  icon: Users,
  labelKey: "workspaces",
  testId: "nav-workspaces",
};

// Workspaces is its own section in every mode (PO decision 2026-11-27):
// desktop sidebar before Settings, last item of the mobile More sheet.
const DESKTOP_ITEMS: NavItem[] = [
  { href: "/", icon: Calendar, labelKey: "home", testId: "nav-home" },
  { href: "/stats", icon: BarChart3, labelKey: "stats", testId: "nav-stats" },
  { href: "/templates", icon: DollarSign, labelKey: "templates", testId: "nav-templates" },
  { href: "/search", icon: Search, labelKey: "search", testId: "nav-search" },
  { href: "/annuals", icon: Bell, labelKey: "annuals", testId: "nav-annuals" },
  { href: "/categories", icon: Tags, labelKey: "categories", testId: "nav-categories" },
  { href: "/history", icon: History, labelKey: "history", testId: "nav-history" },
  WORKSPACES_ITEM,
  { href: "/settings", icon: Settings, labelKey: "settings", testId: "nav-settings" },
];

const MOBILE_PRIMARY: NavItem[] = [
  { href: "/", icon: Calendar, labelKey: "home", testId: "nav-home" },
  { href: "/stats", icon: BarChart3, labelKey: "stats", testId: "nav-stats" },
  { href: "/templates", icon: DollarSign, labelKey: "templates", testId: "nav-templates" },
];

const MORE_ITEMS: NavItem[] = [
  { href: "/search", icon: Search, labelKey: "search", testId: "nav-search" },
  { href: "/annuals", icon: Bell, labelKey: "annuals", testId: "nav-annuals" },
  { href: "/categories", icon: Tags, labelKey: "categories", testId: "nav-categories" },
  { href: "/history", icon: History, labelKey: "history", testId: "nav-history" },
  WORKSPACES_ITEM,
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

export function AppShellClient({
  children,
  email,
  displayName,
  avatarUrl,
  signOutAction,
  workspace,
}: AppShellProps & { workspace: WorkspaceSwitcherInfo | null }) {
  const t = useTranslations("nav");
  const tApp = useTranslations("app");
  const tw = useTranslations("workspaces");
  const pathname = usePathname();
  const wide = pathname.startsWith("/stats");
  // The quiet header control that opens the Home workspace list (§4.12).
  const switcher = workspace ? (
    <Link
      href="/#workspaces"
      aria-label={tw("switcher.open", { name: workspace.activeName })}
      data-testid="workspace-switcher"
      className="inline-flex min-h-11 max-w-[14rem] items-center gap-1 rounded-full px-3 text-sm font-medium"
    >
      <span className="truncate">{workspace.activeName}</span>
      <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
    </Link>
  ) : null;

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

      {/*
        Mobile top bar. The page draws edge to edge (viewport-fit=cover) under a
        translucent iOS status bar, so the bar pads itself down by the top safe
        area: the profile button sits below the clock/Dynamic Island, where taps
        reach the page. Navy in both themes so the white status-bar text stays
        readable.
      */}
      <header
        className="bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-x-0 top-0 z-40 border-b lg:hidden"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
        data-testid="mobile-top-bar"
      >
        <div className="flex h-14 items-center justify-between gap-3 pr-2 pl-4">
          <Link href="/" className="flex min-h-11 min-w-0 items-center gap-2">
            <Image
              src="/images/logo.png"
              alt=""
              width={28}
              height={28}
              className="shrink-0 rounded-md"
            />
            <span className="truncate text-base font-semibold">{tApp("name")}</span>
          </Link>
          {switcher && (
            <div className="text-sidebar-foreground/90 hover:bg-sidebar-accent/40 ml-auto min-w-0 rounded-full">
              {switcher}
            </div>
          )}
          <ProfileMenu
            variant="bar"
            email={email}
            displayName={displayName}
            avatarUrl={avatarUrl}
            signOutAction={signOutAction}
          />
        </div>
      </header>

      <main className="flex-1 pt-(--app-top-offset) pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-60">
        <div
          className={`mx-auto w-full py-6 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:py-8 md:pr-[max(1.5rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))] ${wide ? "max-w-6xl" : "max-w-4xl"}`}
        >
          <div className={`mb-4 hidden items-center lg:flex ${switcher ? "justify-between" : "justify-end"}`}>
            {switcher && (
              <div className="text-foreground bg-card hover:bg-accent rounded-full border">
                {switcher}
              </div>
            )}
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
        // `after:` paints the bar colour below its edge: some iOS 26 releases
        // place `bottom: 0` too high in home-screen web apps, which otherwise
        // leaves a strip of page background under the bar.
        className="bg-card border-border after:bg-card fixed inset-x-0 bottom-0 z-50 flex border-t after:absolute after:inset-x-0 after:top-full after:h-24 lg:hidden"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
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
