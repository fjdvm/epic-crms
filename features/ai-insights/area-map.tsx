"use client";

import { useMemo, useState } from "react";

import { formatPesos } from "@/features/customer-profiles/format";
import map from "@/lib/geo/ph-provinces.json";
import type { AreaFigures, AreaInsights } from "./areas";

export const AREA_METRICS = ["orders", "sales", "failed", "returned", "cod"] as const;
export type AreaMetric = (typeof AREA_METRICS)[number];

const METRIC_LABELS: Record<AreaMetric, string> = {
  orders: "Orders",
  sales: "Sales",
  failed: "Failed deliveries",
  returned: "Returns",
  cod: "Cash on Delivery",
};

/** Rates are shown only once an area has this many Orders, so one bad Order never paints a Province dark. */
export const MIN_ORDERS_FOR_RATE = 3;

/** One hue, light to dark (sequential); no Orders stays neutral gray. */
const STEPS = ["#e4d8f1", "#c9b3e0", "#a985cf", "#8256b3", "#5b2a86"];
const NO_DATA = "#f1f0f3";

const isRate = (metric: AreaMetric) => metric === "failed" || metric === "returned" || metric === "cod";

/** The value an area is coloured and ranked by: a count, centavos, or a 0–1 share; null when there is too little to say. */
export function metricValue(area: AreaFigures, metric: AreaMetric): number | null {
  if (metric === "orders") return area.orders;
  if (metric === "sales") return area.sales;
  if (area.orders < MIN_ORDERS_FOR_RATE) return null;
  return area[metric] / area.orders;
}

function formatMetric(value: number | null, metric: AreaMetric): string {
  if (value === null) return "Too few Orders";
  if (metric === "sales") return formatPesos(value);
  if (isRate(metric)) return `${Math.round(value * 100)}%`;
  return value.toLocaleString("en-PH");
}

/** Change in Orders against the period before; null when there is nothing to compare. */
export function orderChange(area: AreaFigures): { label: string; up: boolean } | null {
  if (area.previousOrders === 0) return area.orders > 0 ? { label: "New", up: true } : null;
  const change = Math.round(((area.orders - area.previousOrders) / area.previousOrders) * 100);
  if (change === 0) return null;
  return { label: `${change > 0 ? "+" : ""}${change}%`, up: change > 0 };
}

function Change({ area }: { area: AreaFigures }) {
  const change = orderChange(area);
  if (!change) return null;
  return (
    <span className={change.up ? "text-xs font-medium text-[#15803d]" : "text-xs font-medium text-[#b91c1c]"}>
      {change.up ? "▲" : "▼"} {change.label}
    </span>
  );
}

export function AreaMap({ insights }: { insights: AreaInsights }) {
  const [metric, setMetric] = useState<AreaMetric>("orders");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);

  const byKey = useMemo(() => new Map(insights.areas.map((a) => [a.key, a])), [insights]);
  const ranked = useMemo(
    () => insights.areas
      .map((area) => ({ area, value: metricValue(area, metric) }))
      .filter((r): r is { area: AreaFigures; value: number } => r.value !== null && r.area.orders > 0)
      .sort((a, b) => b.value - a.value || b.area.orders - a.area.orders),
    [insights, metric],
  );
  const max = ranked[0]?.value ?? 0;

  const fill = (key: string) => {
    const area = byKey.get(key);
    const value = area ? metricValue(area, metric) : null;
    if (!area || area.orders === 0 || value === null || max === 0 || value === 0) return NO_DATA;
    return STEPS[Math.min(STEPS.length - 1, Math.floor((value / max) * STEPS.length))];
  };

  const chosen = selected ? byKey.get(selected) ?? null : null;
  const hovered = hover ? byKey.get(hover.key) : null;

  return (
    <section aria-label="Where our Orders go" className="flex min-w-0 flex-col gap-4 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-5 leading-[normal]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-medium text-[#71717a]">Where our Orders go</h2>
          <p className="mt-1 text-sm text-[#18181b]">Orders counted in Sales, by delivery Province</p>
        </div>
        <div role="radiogroup" aria-label="Show on the map" className="flex flex-wrap gap-1.5">
          {AREA_METRICS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === metric}
              onClick={() => setMetric(m)}
              className="rounded-lg border border-[#e4e4e7] bg-white px-2.5 py-1.5 text-xs font-medium text-[#18181b] aria-checked:border-[#5b2a86] aria-checked:bg-[#5b2a86] aria-checked:text-white"
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative mx-auto w-full max-w-[360px]" onMouseLeave={() => setHover(null)}>
          <svg
            viewBox={map.viewBox}
            role="img"
            aria-label={`Map of the Philippines shaded by ${METRIC_LABELS[metric]}. The list beside it has the same figures.`}
            className="h-auto w-full"
          >
            {map.shapes.map((shape) => (
              <path
                key={shape.key}
                d={shape.d}
                data-area={shape.key}
                fill={fill(shape.key)}
                stroke={shape.key === selected ? "#18181b" : "#ffffff"}
                strokeWidth={shape.key === selected ? 1.5 : 0.5}
                className="cursor-pointer"
                onMouseMove={(event) => {
                  const box = event.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                  if (box) setHover({ key: shape.key, x: event.clientX - box.left, y: event.clientY - box.top });
                }}
                onClick={() => setSelected(shape.key === selected ? null : byKey.has(shape.key) ? shape.key : null)}
              />
            ))}
          </svg>
          {hover && (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-[#e6e1ee] bg-white px-3 py-2 text-xs shadow-md"
              style={{ left: hover.x, top: hover.y }}
            >
              <p className="font-medium text-[#18181b]">{hovered?.name ?? areaLabel(hover.key)}</p>
              {hovered ? (
                <p className="mt-0.5 text-[#52525b]">
                  {METRIC_LABELS[metric]}: {formatMetric(metricValue(hovered, metric), metric)}
                  {metric !== "orders" && ` · ${hovered.orders} Orders`}
                </p>
              ) : (
                <p className="mt-0.5 text-[#71717a]">No Orders</p>
              )}
            </div>
          )}
          <Legend metric={metric} max={max} />
        </div>

        {chosen ? (
          <AreaDetail area={chosen} onBack={() => setSelected(null)} />
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium text-[#18181b]">Top areas by {METRIC_LABELS[metric].toLowerCase()}</h3>
            {ranked.length === 0 ? (
              <p className="text-sm text-[#71717a]">
                {insights.areas.length === 0 ? "No delivery Orders in this period" : `No area has ${MIN_ORDERS_FOR_RATE} or more Orders yet`}
              </p>
            ) : (
              <ol className="flex flex-col">
                {ranked.slice(0, 8).map(({ area, value }, index) => (
                  <li key={area.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(area.key)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-[#f5f0fa]"
                    >
                      <span className="w-4 text-xs text-[#a1a1aa]">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[#18181b]">{area.name}</span>
                      <Change area={area} />
                      <span className="tabular-nums text-[#18181b]">{formatMetric(value, metric)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {insights.unmapped.orders > 0 && (
              <p className="text-xs text-[#71717a]">
                {insights.unmapped.orders} {insights.unmapped.orders === 1 ? "Order has" : "Orders have"} an address the map can&apos;t place.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function areaLabel(key: string) {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

function Legend({ metric, max }: { metric: AreaMetric; max: number }) {
  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-[#71717a]" aria-hidden="true">
      <span className="h-2.5 w-4 rounded-sm" style={{ background: NO_DATA }} />
      <span>None</span>
      <span className="ml-2">Low</span>
      <span className="flex h-2.5 flex-1 overflow-hidden rounded-sm">
        {STEPS.map((step) => <span key={step} className="flex-1" style={{ background: step }} />)}
      </span>
      <span>{max > 0 ? formatMetric(max, metric) : "High"}</span>
    </div>
  );
}

function AreaDetail({ area, onBack }: { area: AreaFigures; onBack: () => void }) {
  const rate = (count: number) => (area.orders < MIN_ORDERS_FOR_RATE ? "Too few Orders" : `${Math.round((count / area.orders) * 100)}%`);
  const figures: [string, string][] = [
    ["Orders", area.orders.toLocaleString("en-PH")],
    ["Sales", formatPesos(area.sales)],
    ["Average order", area.orders > 0 ? formatPesos(Math.round(area.sales / area.orders)) : "–"],
    ["Failed deliveries", rate(area.failed)],
    ["Returns", rate(area.returned)],
    ["Cash on Delivery", rate(area.cod)],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="rounded-lg px-2 py-1 text-sm font-medium text-[#5b2a86] hover:bg-[#f5f0fa]">
          ← All areas
        </button>
      </div>
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-semibold text-[#18181b]">{area.name}</h3>
        <Change area={area} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {figures.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-[#71717a]">{label}</dt>
            <dd className="tabular-nums text-[#18181b]">{value}</dd>
          </div>
        ))}
      </dl>
      <h4 className="mt-1 text-sm font-medium text-[#18181b]">Top cities</h4>
      <ol className="flex flex-col gap-1 text-sm">
        {area.cities.slice(0, 5).map((city) => (
          <li key={city.name} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[#18181b]">{city.name}</span>
            <span className="tabular-nums text-[#52525b]">{city.orders} {city.orders === 1 ? "Order" : "Orders"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Shown at once while the figures load, the same size as the map card. */
export function AreaMapSkeleton() {
  return (
    <section aria-label="Where our Orders go" aria-busy="true" className="flex min-w-0 flex-col gap-4 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-5 leading-[normal]">
      <h2 className="text-[13px] font-medium text-[#71717a]">Where our Orders go</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2">
        <div className="mx-auto aspect-[400/697] w-full max-w-[360px] animate-pulse rounded-xl bg-[#f4f4f5]" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-6 animate-pulse rounded bg-[#f4f4f5]" />)}
        </div>
      </div>
    </section>
  );
}
