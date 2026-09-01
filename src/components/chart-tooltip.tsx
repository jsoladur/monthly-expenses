"use client";

const INTERNAL_KEYS = new Set([
  "cents",
  "value",
  "amount",
  "extra",
  "rate",
  "share",
  "hcc",
  "rolling",
  "deltaCents",
  "spend",
  "income",
  "savings",
]);

export const CHART_TOOLTIP_WRAPPER = {
  zIndex: 50,
  pointerEvents: "none" as const,
  outline: "none",
  maxWidth: "min(16rem, calc(100vw - 2rem))",
};

/** Keep the popup inside the chart so it never runs off the phone screen. */
export const CHART_TOOLTIP_PROPS = {
  wrapperStyle: CHART_TOOLTIP_WRAPPER,
  allowEscapeViewBox: { x: false, y: false } as const,
};

export const CHART_LEGEND_WRAPPER = {
  fontSize: "0.75rem",
  zIndex: 0,
};

export const CHART_TOOLTIP_BOX =
  "bg-card text-card-foreground border-border relative z-50 w-max max-w-full rounded-lg border px-3 py-2 shadow-sm";

type PayloadItem = {
  name?: string | number;
  dataKey?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  payload?: Record<string, unknown>;
};

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: ReadonlyArray<PayloadItem>;
  label?: string | number;
  formatValue: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((item) => item.value !== undefined && item.value !== null);
  if (rows.length === 0) return null;

  return (
    <div className={CHART_TOOLTIP_BOX}>
      {label !== undefined && label !== "" && (
        <p className="mb-1.5 text-xs font-medium wrap-break-word">{String(label)}</p>
      )}
      <ul className="flex flex-col gap-1">
        {rows.map((item, i) => {
          const raw = Array.isArray(item.value) ? item.value[0] : item.value;
          const num = typeof raw === "number" ? raw : Number(raw);
          if (!Number.isFinite(num)) return null;
          const key = String(item.dataKey ?? item.name ?? i);
          const name = seriesLabel(item);
          return (
            <li
              key={`${key}-${i}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 text-xs"
            >
              {name ? (
                <span className="text-muted-foreground flex min-w-0 items-start gap-1.5">
                  {item.color ? (
                    <span
                      className="mt-1 size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                      aria-hidden
                    />
                  ) : null}
                  <span className="min-w-0 wrap-break-word">{name}</span>
                </span>
              ) : (
                <span />
              )}
              <span className="amount shrink-0 tabular-nums">{formatValue(num)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function seriesLabel(item: PayloadItem): string | null {
  const name = item.name == null ? "" : String(item.name);
  if (!name) return null;
  if (INTERNAL_KEYS.has(name)) return null;
  return name;
}
