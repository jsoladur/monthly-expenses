// ============================================================================
// Workbook copy DTO (UC-19). Filled from next-intl at the action boundary.
// The builder must not import next-intl.
// ============================================================================

export type ExportCopy = {
  appName: string;
  currency: string;
  incomes: string;
  actuals: string;
  committed: string;
  estimated: string;
  summary: string;
  category: string;
  name: string;
  notes: string;
  amount: string;
  remaining: string;
  original: string;
  origin: string;
  total: string;
  income: string;
  reserved: string;
  totalExpenses: string;
  savings: string;
  originCloned: string;
  originMonthOnly: string;
};

export const EN_EXPORT_COPY: ExportCopy = {
  appName: "Monthly Expenses",
  currency: "Currency",
  incomes: "Incomes",
  actuals: "Actuals",
  committed: "Committed",
  estimated: "Estimated",
  summary: "Summary",
  category: "Category",
  name: "Name",
  notes: "Notes",
  amount: "Amount",
  remaining: "Remaining",
  original: "Original",
  origin: "Origin",
  total: "Total",
  income: "Income",
  reserved: "Reserved",
  totalExpenses: "Total Expenses",
  savings: "Potential savings",
  originCloned: "Cloned",
  originMonthOnly: "One-off",
};
