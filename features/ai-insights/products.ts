import type { ProductFigures } from "./insights";

/**
 * "Top products" and each area's favourite, ranked from the stored morning run. Pure: no React and no data access, so the
 * page, the PDF and the tests all rank the same way.
 */

export const METRICS = ["units", "value", "orders", "rating"] as const;
export type Metric = (typeof METRICS)[number];

/** A product's rating shows only once this many of its Orders have Feedback, so one review never tops the list. */
export const MIN_RATINGS = 3;

export const METRIC_LABELS: Record<Metric, string> = { units: "Units sold", value: "Sales value", orders: "Orders", rating: "Rating" };

/** The figure a product is ranked by; null when there is too little to say (a rating from too few Orders). */
export function metricValue(row: ProductFigures, metric: Metric): number | null {
  switch (metric) {
    case "units": return row.units;
    case "value": return row.value;
    case "orders": return row.orders;
    case "rating": return row.ratings >= MIN_RATINGS ? row.ratingTotal / row.ratings : null;
  }
}

const peso = (centavos: number) => `₱${Math.round(centavos / 100).toLocaleString("en-PH")}`;

export function formatMetric(row: ProductFigures, metric: Metric): string {
  const value = metricValue(row, metric);
  if (value === null) return row.ratings ? `${row.ratings} rated` : "No ratings";
  if (metric === "value") return peso(value);
  if (metric === "rating") return `${value.toFixed(1)} ★ (${row.ratings})`;
  return value.toLocaleString("en-PH");
}

/** "Ube Jam 500 g", or just "Ube Jam" when sizes are counted together or the line had no size. */
export const productName = (row: Pick<ProductFigures, "product" | "size">) => (row.size ? `${row.product} ${row.size}` : row.product);

/** Change in units (or Orders) against the period before; null when there is nothing to compare or it ranks by value or rating. */
export function productChange(row: ProductFigures, metric: Metric): { label: string; up: boolean } | null {
  if (metric !== "units" && metric !== "orders") return null;
  const [now, before] = metric === "units" ? [row.units, row.previousUnits] : [row.orders, row.previousOrders];
  if (before === 0) return now > 0 ? { label: "New", up: true } : null;
  const change = Math.round(((now - before) / before) * 100);
  return change === 0 ? null : { label: `${change > 0 ? "+" : ""}${change}%`, up: change > 0 };
}

export interface RankOptions { scope: ProductFigures["scope"]; place?: string | null; bySize: boolean; metric: Metric }

/**
 * The products sold in one place in the period, best first. Products with no figure for the metric (too few ratings)
 * go last. Ties fall to units sold, then the name.
 */
export function rankProducts(rows: readonly ProductFigures[], { scope, place = null, bySize, metric }: RankOptions): ProductFigures[] {
  return rows
    .filter((r) => r.scope === scope && r.place === (scope === "all" ? null : place) && (r.size !== null) === bySize && r.orders > 0)
    .sort((a, b) => {
      const x = metricValue(a, metric), y = metricValue(b, metric);
      if (x === null || y === null) { if (x !== y) return x === null ? 1 : -1; }
      else if (x !== y) return y - x;
      return b.units - a.units || productName(a).localeCompare(productName(b));
    });
}

/** Each area's (or city's) favourite product by the metric. A place where nothing has a figure (too few ratings) has none. */
export function favouriteByPlace(rows: readonly ProductFigures[], { scope, bySize, metric }: { scope: "province" | "city"; bySize: boolean; metric: Metric }) {
  const places = new Set(rows.filter((r) => r.scope === scope && r.place !== null).map((r) => r.place!));
  const out = new Map<string, ProductFigures>();
  for (const place of places) {
    const [best] = rankProducts(rows, { scope, place, bySize, metric });
    if (best && metricValue(best, metric) !== null) out.set(place, best);
  }
  return out;
}
