import type postgres from "postgres";

import { customerNameSql } from "@/lib/deleted-customer";
import { readStock, type ImsSizeStock } from "@/lib/storefront";

/** A Size with fewer than this many available is low stock; the shop then says "Only N left". Matches the storefront. */
export const LOW_STOCK_BELOW = 10;

export type ShopShows = "In stock" | "Sold out" | { left: number } | "Unknown";

/** What the online shop says about a Size, from what the IMS has available. */
export function shopShows(available: number | null): ShopShows {
  if (available === null) return "Unknown";
  if (available <= 0) return "Sold out";
  return available < LOW_STOCK_BELOW ? { left: available } : "In stock";
}

export const shopLabel = (shows: ShopShows): string =>
  typeof shows === "object" ? `Only ${shows.left} left` : shows;

/** How an Order holding a Reservation is labelled on Products & Stocks. */
export type HoldingStatus = "Placed" | "Awaiting payment" | "Paid and waiting to dispatch";

export interface HoldingOrder { orderId: number; customer: string; status: HoldingStatus; quantity: number }

const HOLDING_STATUS: Record<string, HoldingStatus> = {
  placed: "Placed",
  confirmed: "Awaiting payment",
  "awaiting payment": "Awaiting payment",
  paid: "Paid and waiting to dispatch",
  preparing: "Paid and waiting to dispatch",
};

export interface StockRow {
  sizeId: number;
  product: string;
  size: string;
  /** Null when the IMS could not answer for this Size. */
  inStock: number | null;
  reserved: number | null;
  available: number | null;
  shows: ShopShows;
  /** Orders whose Reservation holds this Size; null when they could not be read. */
  orders: HoldingOrder[] | null;
}

export interface StockPage {
  rows: StockRow[];
  /** False when the IMS could not be read, so every quantity is unknown. */
  imsReachable: boolean;
  summary: { sizes: number; soldOut: number; reserved: number; low: number };
}

export type StockResult = { ok: true; page: StockPage } | { ok: false };

/** The Sizes the shop sells, with what the IMS holds. Read on demand; the IMS stays the source of truth. */
export async function loadStock(
  connect: () => postgres.Sql,
  read: (sizeIds: number[]) => Promise<Map<number, ImsSizeStock> | null> = readStock,
): Promise<StockResult> {
  try {
    const sizes = await connect()<{ id: number; product: string; size: string }[]>`
      select s.id, p.name as product, s.label as size
      from public.sizes s join public.products p on p.slug = s.product_slug
      order by p.name, s.price_in_centavos, s.id`;
    const stock = await read(sizes.map((size) => size.id));
    const holding = await loadHoldingOrders(connect);
    const rows: StockRow[] = sizes.map((size) => {
      const held = stock?.get(size.id);
      const available = held?.available ?? null;
      return {
        sizeId: size.id, product: size.product, size: size.size,
        inStock: held?.quantity ?? null, reserved: held?.reserved ?? null, available, shows: shopShows(available),
        orders: holding?.get(size.id) ?? (holding ? [] : null),
      };
    });
    return {
      ok: true,
      page: {
        rows, imsReachable: stock !== null,
        summary: {
          sizes: rows.length,
          soldOut: rows.filter((row) => row.shows === "Sold out").length,
          reserved: rows.reduce((sum, row) => sum + (row.reserved ?? 0), 0),
          low: rows.filter((row) => typeof row.shows === "object").length,
        },
      },
    };
  } catch (error) {
    console.error("Products & stock could not read the ecommerce database", error);
    return { ok: false };
  }
}

/**
 * Per Size, the Orders whose open Reservation still holds it. Same rule as the Order detail: a
 * released line, a released Reservation, or an Order that is packed away or cancelled holds nothing.
 */
async function loadHoldingOrders(connect: () => postgres.Sql): Promise<Map<number, HoldingOrder[]> | null> {
  try {
    const found = await connect()<{ order_id: number; customer: string; status: string; size_id: string; quantity: string }[]>`
      select o.id as order_id, ${connect().unsafe(customerNameSql("c"))} as customer, o.status,
        (line->>'sizeId') as size_id, sum((line->>'quantity')::int) as quantity
      from public.stock_reservations r
      join public.orders o on o.id = r.order_id
      join public.customers c on c.id = o.customer_id
      cross join lateral jsonb_array_elements(r.lines) as line
      where r.state = 'placed' and o.status in ('placed', 'confirmed', 'awaiting payment', 'paid', 'preparing')
        and coalesce((line->>'release')::boolean, false) = false and coalesce((line->>'released')::boolean, false) = false
      group by o.id, c.id, o.status, line->>'sizeId'
      order by o.id`;
    const bySize = new Map<number, HoldingOrder[]>();
    for (const row of found) {
      const status = HOLDING_STATUS[row.status];
      if (!status) continue;
      const list = bySize.get(Number(row.size_id)) ?? [];
      list.push({ orderId: row.order_id, customer: row.customer, status, quantity: Number(row.quantity) });
      bySize.set(Number(row.size_id), list);
    }
    return bySize;
  } catch (error) {
    console.error("The Orders holding stock could not be read", error);
    return null;
  }
}

/** What an Order set aside for one of its lines, and how many of that Size are still available. */
export interface LineReservation { reserved: number; left: number | null }

/**
 * Reserved quantity per Order line, from the storefront's Reservation. Only an Order not yet packed
 * holds one (the IMS takes the stock out at packing); a released or cancelled line reserves nothing. Failure returns an empty map so the rest of the Order detail still opens.
 */
export async function loadLineReservations(
  connect: () => postgres.Sql,
  orderId: number,
  read: (sizeIds: number[]) => Promise<Map<number, ImsSizeStock> | null> = readStock,
): Promise<Map<number, LineReservation>> {
  try {
    const [reservation] = await connect()<{ lines: { orderLineId?: number; sizeId: number; quantity: number; release?: boolean; released?: boolean }[] }[]>`
      select r.lines from public.stock_reservations r join public.orders o on o.id = r.order_id
      where r.order_id = ${orderId} and r.state = 'placed'
        and o.status in ('placed', 'confirmed', 'awaiting payment', 'paid', 'preparing')`;
    const held = (reservation?.lines ?? []).filter((line) => line.orderLineId !== undefined && !line.release && !line.released);
    if (held.length === 0) return new Map();
    const stock = await read(held.map((line) => line.sizeId));
    return new Map(held.map((line) => [line.orderLineId!, { reserved: line.quantity, left: stock?.get(line.sizeId)?.available ?? null }]));
  } catch (error) {
    console.error(`The Reservation of Order #${orderId} could not be read`, error);
    return new Map();
  }
}
