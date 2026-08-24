"use client";

import { useState } from "react";

interface MonthWorkspaceTabsProps {
  actualsTab: React.ReactNode;
  incomesTab: React.ReactNode;
  reservedTab: React.ReactNode;
  labels: {
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

export function MonthWorkspaceTabs({
  actualsTab,
  incomesTab,
  reservedTab,
  labels,
  counts,
}: MonthWorkspaceTabsProps) {
  const [activeTab, setActiveTab] = useState<"actuals" | "incomes" | "reserved">("actuals");

  const tabs = [
    { id: "actuals" as const, label: labels.actuals, count: counts.actuals },
    { id: "incomes" as const, label: labels.incomes, count: counts.incomes },
    { id: "reserved" as const, label: labels.reserved, count: counts.reserved },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border flex gap-1 overflow-x-auto border-b" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
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

      <div role="tabpanel" id="tabpanel-actuals" hidden={activeTab !== "actuals"}>
        {activeTab === "actuals" && actualsTab}
      </div>

      <div role="tabpanel" id="tabpanel-incomes" hidden={activeTab !== "incomes"}>
        {activeTab === "incomes" && incomesTab}
      </div>

      <div role="tabpanel" id="tabpanel-reserved" hidden={activeTab !== "reserved"}>
        {activeTab === "reserved" && reservedTab}
      </div>
    </div>
  );
}
