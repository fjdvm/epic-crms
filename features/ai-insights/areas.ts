import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "@/features/customer-profiles/rules";
import type { Period } from "@/features/dashboard/period";
import { addressArea, areaName } from "@/lib/geo/areas";
import { notReplacement } from "@/lib/replacement-order";

export interface CityFigures { name: string; orders: number; sales: number }

/** One map area (a Province, or Metro Manila). Money in centavos. */
export interface AreaFigures {
  key: string;
  name: string;
  orders: number;
  sales: number;
  /** Orders paid on delivery. */
  cod: number;
  /** Orders with at least one Failed delivery. */
  failed: number;
  /** Orders with at least one Return. */
  returned: number;
  previousOrders: number;
  cities: CityFigures[];
}

export interface AreaInsights {
  areas: AreaFigures[];
  /** Delivered Orders whose address names no known Province or city. */
  unmapped: { orders: number; sales: number };
}

interface Row {
  province: string; city: string; current: boolean;
  orders: number; sales: string; cod: number; failed: number; returned: number;
}

/**
 * Orders counted in Sales, by delivery address, for the period and the one before it.
 * Counts only, aggregated to city: no customer, street or barangay leaves this function.
 */
export async function areaInsightsIn(sql: postgres.Sql, period: Period): Promise<AreaInsights> {
  const rows = await sql<Row[]>`
    select a.province, a.city, o.created_at >= ${period.start} as current,
      count(*)::int as orders,
      sum(o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0)
        - coalesce((select sum(r.amount_in_centavos) from public.order_returns r
            where r.order_id = o.id and r.status = 'refunded'), 0))::bigint as sales,
      count(*) filter (where o.payment_method = 'cash-on-delivery')::int as cod,
      count(*) filter (where exists (select 1 from public.failed_deliveries f where f.order_id = o.id))::int as failed,
      count(*) filter (where exists (select 1 from public.order_returns r where r.order_id = o.id))::int as returned
    from public.orders o
    join public.order_delivery_addresses a on a.order_id = o.id
    where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")}
      and o.created_at >= ${period.previous.start} and o.created_at < ${period.end}
    group by a.province, a.city, current`;

  const areas = new Map<string, AreaFigures & { byCity: Map<string, CityFigures> }>();
  const unmapped = { orders: 0, sales: 0 };
  for (const row of rows) {
    const key = addressArea(row.province, row.city);
    if (!row.current) {
      if (key) entry(key).previousOrders += row.orders;
      continue;
    }
    if (!key) {
      unmapped.orders += row.orders;
      unmapped.sales += Number(row.sales);
      continue;
    }
    const area = entry(key);
    area.orders += row.orders;
    area.sales += Number(row.sales);
    area.cod += row.cod;
    area.failed += row.failed;
    area.returned += row.returned;
    const cityName = row.city.trim();
    const city = area.byCity.get(cityName) ?? { name: cityName, orders: 0, sales: 0 };
    city.orders += row.orders;
    city.sales += Number(row.sales);
    area.byCity.set(cityName, city);
  }

  function entry(key: string) {
    let area = areas.get(key);
    if (!area) {
      area = { key, name: areaName(key), orders: 0, sales: 0, cod: 0, failed: 0, returned: 0, previousOrders: 0, cities: [], byCity: new Map() };
      areas.set(key, area);
    }
    return area;
  }

  return {
    areas: [...areas.values()]
      .map(({ byCity, ...area }) => ({
        ...area,
        cities: [...byCity.values()].sort((a, b) => b.orders - a.orders || b.sales - a.sales || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.orders - a.orders || b.sales - a.sales || a.name.localeCompare(b.name)),
    unmapped,
  };
}
