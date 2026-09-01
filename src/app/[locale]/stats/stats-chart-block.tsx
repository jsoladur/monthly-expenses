import { Collapsible } from "@/components/ui/collapsible";

export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function StatsChartBlock({
  title,
  help,
  children,
  table,
  testId,
  tableLabel,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
  table: React.ReactNode;
  testId: string;
  tableLabel: string;
}) {
  return (
    <section
      className="bg-card text-card-foreground flex flex-col gap-3 overflow-visible rounded-lg border p-4"
      data-testid={testId}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs leading-relaxed">{help}</p>
      </div>
      <div className="relative z-10 h-72 w-full min-w-0 overflow-visible">{children}</div>
      <Collapsible title={tableLabel}>{table}</Collapsible>
    </section>
  );
}

export function StatsDataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string>>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={`h-${i}`} className="text-muted-foreground pb-2 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-border border-t">
              {row.map((cell, j) => (
                <td key={j} className={`py-1.5 pr-3 ${j > 0 ? "amount tabular-nums" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
