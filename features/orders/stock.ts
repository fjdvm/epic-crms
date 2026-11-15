import type postgres from "postgres";

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

export interface StockRow {
  sizeId: number;
  product: string;
  size: string;
  /** Null when the IMS could not answer for this Size. */
  inStock: number | null;
  reserved: number | null;
  available: number | null;
  shows: ShopShows;
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
    const rows: StockRow[] = sizes.map((size) => {
      const held = stock?.get(size.id);
      const available = held?.available ?? null;
      return {
        sizeId: size.id, product: size.product, size: size.size,
        inStock: held?.quantity ?? null, reserved: held?.reserved ?? null, available, shows: shopShows(available),
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

/** What an Order set aside for one of its lines, and how many of that Size are still available. */
export interface LineReservation { reserved: number; left: number | null }

/**
 * Reserved quantity per Order line, from the storefront's Reservation. A released or cancelled line
 * reserves nothing. Failure returns an empty map so the rest of the Order detail still opens.
 */
export async function loadLineReservations(
  connect: () => postgres.Sql,
  orderId: number,
  read: (sizeIds: number[]) => Promise<Map<number, ImsSizeStock> | null> = readStock,
): Promise<Map<number, LineReservation>> {
  try {
    const [reservation] = await connect()<{ lines: { orderLineId?: number; sizeId: number; quantity: number; release?: boolean; released?: boolean }[] }[]>`
      select lines from public.stock_reservations where order_id = ${orderId} and state = 'placed'`;
    const held = (reservation?.lines ?? []).filter((line) => line.orderLineId !== undefined && !line.release && !line.released);
    if (held.length === 0) return new Map();
    const stock = await read(held.map((line) => line.sizeId));
    return new Map(held.map((line) => [line.orderLineId!, { reserved: line.quantity, left: stock?.get(line.sizeId)?.available ?? null }]));
  } catch (error) {
    console.error(`The Reservation of Order #${orderId} could not be read`, error);
    return new Map();
  }
}
