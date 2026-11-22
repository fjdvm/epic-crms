import type postgres from "postgres";

import { readStock, type ImsSizeStock } from "@/lib/storefront";

/**
 * Whether the IMS has enough of every item on a Return to send it again as a Replacement.
 * `unknown` means the stock could not be read; the storefront still checks and reserves when the replacement is made.
 */
export type ReplacementStock =
  | { state: "available" }
  | { state: "short"; items: { product: string; size: string }[] }
  | { state: "unknown" };

/**
 * Same mapping as the storefront's Replacement Order: each Return line finds its Size on the original Order's Reservation,
 * the only place an Order line's Size is recorded.
 */
export async function loadReplacementStock(
  connect: () => postgres.Sql,
  returnId: number,
  read: (sizeIds: number[]) => Promise<Map<number, ImsSizeStock> | null> = readStock,
): Promise<ReplacementStock> {
  try {
    // Without a Reservation table there is nothing to map a line to its Size; ask first, so no query fails.
    const [table] = await connect()<{ found: boolean }[]>`select to_regclass('public.stock_reservations') is not null as found`;
    if (!table?.found) return { state: "unknown" };
    const rows = await connect()<{ product_name: string; size_label: string; quantity: number; size_id: string | null }[]>`
      select i.product_name, i.size_label, i.quantity,
        (select line->>'sizeId' from public.stock_reservations sr cross join lateral jsonb_array_elements(sr.lines) as line
          where sr.order_id = r.order_id and (line->>'orderLineId')::int = i.order_line_id limit 1) as size_id
      from public.order_return_items i join public.order_returns r on r.id = i.return_id
      where i.return_id = ${returnId} order by i.order_line_id`;
    if (rows.length === 0 || rows.some((row) => row.size_id === null)) return { state: "unknown" };
    const stock = await read([...new Set(rows.map((row) => Number(row.size_id)))]);
    if (!stock) return { state: "unknown" };
    // Lines of the same Size share what is available.
    const needed = new Map<number, number>();
    for (const row of rows) needed.set(Number(row.size_id), (needed.get(Number(row.size_id)) ?? 0) + row.quantity);
    const short = rows.filter((row) => {
      const available = stock.get(Number(row.size_id))?.available;
      return available === null || available === undefined ? false : available < needed.get(Number(row.size_id))!;
    });
    if (rows.some((row) => { const a = stock.get(Number(row.size_id))?.available; return a === null || a === undefined; }) && short.length === 0) {
      return { state: "unknown" };
    }
    return short.length ? { state: "short", items: short.map((row) => ({ product: row.product_name, size: row.size_label })) } : { state: "available" };
  } catch (error) {
    console.error(`Stock for a replacement of Return RMA-${returnId} could not be read`, error);
    return { state: "unknown" };
  }
}

export function shortStockReason(stock: Extract<ReplacementStock, { state: "short" }>): string {
  return `Not enough stock for a replacement: ${stock.items.map((item) => item.size ? `${item.product} (${item.size})` : item.product).join(", ")}.`;
}
