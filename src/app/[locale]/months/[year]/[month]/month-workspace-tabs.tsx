"use client";

import { useState } from "react";

interface MonthWorkspaceTabsProps {
  actualsTab: React.ReactNode;
  incomesTab: React.ReactNode;
  reservedTab: React.ReactNode;
  statsTab: React.ReactNode;
  labels: {
    data: string;
    stats: string;
    actuals: string;
    incomes: string;
    reserved: string;
  };
  counts: {
    actuals: number;
    incomes: number;
    reserved: number;
  };
}

type ParentTab = "data" | "stats";
type DataTab = "actuals" | "incomes" | "reserved";

export function MonthWorkspaceTabs({
  actualsTab,
  incomesTab,
  reservedTab,
  statsTab,
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

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Main sections">
        <button
          role="tab"
          aria-selected={activeParentTab === "data"}
          aria-controls="tabpanel-data"
          onClick={() => setActiveParentTab("data")}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            activeParentTab === "data"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {labels.data}
        </button>
        <button
          role="tab"
          aria-selected={activeParentTab === "stats"}
          aria-controls="tabpanel-stats"
          onClick={() => setActiveParentTab("stats")}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            activeParentTab === "stats"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {labels.stats}
        </button>
      </div>

      {activeParentTab === "data" && (
        <>
          <div className="border-border flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Data sections">
            {dataTabs.map((tab) => (
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
                {tab.label}
                <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-xs">
                  {tab.count}
                </span>
              </button>
            ))}
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

      {activeParentTab === "stats" && (
        <div role="tabpanel" id="tabpanel-stats">
          {statsTab}
        </div>
      )}
    </div>
  );
}
