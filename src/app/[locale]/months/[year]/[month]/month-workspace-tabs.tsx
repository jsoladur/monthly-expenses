"use client";

import { useState, type ReactNode } from "react";
import {
  BarChart3,
  Bookmark,
  CircleHelp,
  List,
  Receipt,
  Scale,
  Wallet,
  type LucideIcon,
} from "lucide-react";

interface MonthWorkspaceTabsProps {
  actualsTab: ReactNode;
  incomesTab: ReactNode;
  reservedTab: ReactNode;
  checkTab: ReactNode;
  statsTab: ReactNode;
  helpTab: ReactNode;
  labels: {
    data: string;
    check: string;
    checkFlagged: string;
    stats: string;
    actuals: string;
    incomes: string;
    reserved: string;
    help: string;
  };
  counts: {
    actuals: number;
    incomes: number;
    reserved: number;
    /** Categories flagged by the estimate check (UC-25); badge hidden at 0. */
    flagged: number;
  };
}

type ParentTab = "data" | "check" | "stats" | "help";
type DataTab = "actuals" | "incomes" | "reserved";

const PARENT_ICONS: Record<ParentTab, LucideIcon> = {
  data: List,
  check: Scale,
  stats: BarChart3,
  help: CircleHelp,
};

const DATA_ICONS: Record<DataTab, LucideIcon> = {
  actuals: Receipt,
  reserved: Bookmark,
  incomes: Wallet,
};

export function MonthWorkspaceTabs({
  actualsTab,
  incomesTab,
  reservedTab,
  checkTab,
  statsTab,
  helpTab,
  labels,
  counts,
}: MonthWorkspaceTabsProps) {
  const [activeParentTab, setActiveParentTab] = useState<ParentTab>("data");

  const [activeDataTab, setActiveDataTab] = useState<DataTab>("actuals");

  const dataTabs = [
    { id: "actuals" as const, label: labels.actuals, count: counts.actuals },
    { id: "reserved" as const, label: labels.reserved, count: counts.reserved },
    { id: "incomes" as const, label: labels.incomes, count: counts.incomes },
  ];

  const parentTabs: Array<{ id: ParentTab; label: string }> = [
    { id: "data", label: labels.data },
    { id: "check", label: labels.check },
    { id: "stats", label: labels.stats },
    { id: "help", label: labels.help },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Main sections">
        {parentTabs.map((tab) => {
          const Icon = PARENT_ICONS[tab.id];
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeParentTab === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => setActiveParentTab(tab.id)}
              data-testid={`month-tab-${tab.id}`}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                activeParentTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              {tab.label}
              {tab.id === "check" && counts.flagged > 0 && (
                <span
                  className="bg-estimated min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-bold text-white tabular-nums"
                  aria-label={labels.checkFlagged}
                  data-testid="estimate-check-badge"
                >
                  {counts.flagged}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeParentTab === "data" && (
        <>
          <div className="border-border flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Data sections">
            {dataTabs.map((tab) => {
              const Icon = DATA_ICONS[tab.id];
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeDataTab === tab.id}
                  aria-controls={`tabpanel-${tab.id}`}
                  onClick={() => setActiveDataTab(tab.id)}
                  className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    activeDataTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {tab.label}
                  <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-xs">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id="tabpanel-actuals" hidden={activeDataTab !== "actuals"}>
            {activeDataTab === "actuals" && actualsTab}
          </div>

          <div role="tabpanel" id="tabpanel-incomes" hidden={activeDataTab !== "incomes"}>
            {activeDataTab === "incomes" && incomesTab}
          </div>

          <div role="tabpanel" id="tabpanel-reserved" hidden={activeDataTab !== "reserved"}>
            {activeDataTab === "reserved" && reservedTab}
          </div>
        </>
      )}

      {activeParentTab === "check" && (
        <div role="tabpanel" id="tabpanel-check">
          {checkTab}
        </div>
      )}

      {activeParentTab === "stats" && (
        <div role="tabpanel" id="tabpanel-stats">
          {statsTab}
        </div>
      )}

      {activeParentTab === "help" && (
        <div role="tabpanel" id="tabpanel-help">
          {helpTab}
        </div>
      )}
    </div>
  );
}
