import type postgres from "postgres";

import { customerNameSql } from "@/lib/deleted-customer";
import { readProductFeed, readProductStock, readStock, type ImsProduct, type ImsSizeStock } from "@/lib/storefront";

import type { ProductContent } from "./product-content";
import type { StockMirror } from "./stock-mirror";

/** A Size with fewer than this many available is low stock; the shop then says "Only N left". Matches the storefront. */
export const LOW_STOCK_BELOW = 10;

/** "Ube Jam Extreme · 250g Container"; the name alone for a product with no Variant. */
export const rowLabel = (row: Pick<StockRow, "product" | "size">): string => (row.size ? `${row.product} · ${row.size}` : row.product);

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

/** What the IMS holds that the shop does not sell: missing details, or a product the IMS removed or deactivated. */
export type StockMarker = { kind: "not-on-shop"; missing: ("name" | "image" | "price")[] } | { kind: "discontinued" };

export interface StockRow {
  sizeId: number;
  product: string;
  /** The IMS Variant; empty for a product with no Variant (one unlabelled default Size). */
  size: string;
  /** The image Staff published, else the IMS image; null when the product has neither. */
  image: string | null;
  /** What Staff published for the shop; empty until they add one. */
  description: string;
  marker: StockMarker | null;
  /** The price in pesos from CREOMS's copy of the IMS; null when the IMS has none. */
  price: number | null;
  /** Null when CREOMS has no quantity for this Size yet. */
  inStock: number | null;
  /** What open Orders hold in CREOMS's own Reservations; null when those Orders could not be read. */
  reserved: number | null;
  available: number | null;
  shows: ShopShows;
  /** Orders whose Reservation holds this Size; null when they could not be read. */
  orders: HoldingOrder[] | null;
}

export interface StockPage {
  rows: StockRow[];
  /** False when CREOMS has no copy of the IMS yet (nothing was ever read), so every quantity is unknown. */
  hasStock: boolean;
  summary: { sizes: number; soldOut: number; reserved: number; low: number };
}

export type StockResult = { ok: true; page: StockPage } | { ok: false };

const markerOf = (item: ImsProduct, content?: ProductContent): StockMarker | null => {
  if (!item.active) return { kind: "discontinued" };
  const missing = ([["name", !item.name], ["image", !item.image && !content?.imageUrl], ["price", item.price === null]] as const)
    .filter(([, absent]) => absent).map(([what]) => what);
  return missing.length > 0 ? { kind: "not-on-shop", missing } : null;
};

/** What Staff published, by product id. The table being unreadable only means the IMS image and no description show. */
async function readContent(ids: number[], read: ContentReader): Promise<Map<number, ProductContent>> {
  try { return await read(ids); }
  catch (error) {
    console.error("Published product content could not be read", error);
    return new Map();
  }
}

type ContentReader = (productIds: number[]) => Promise<Map<number, ProductContent>>;
/** Stock.ts is also bundled for the browser, so the server reader (`published-content.ts`) is passed in by its callers. */
const noContent: ContentReader = async () => new Map();

const sizeSource = (item: ImsProduct, content: ProductContent | undefined): SizeSource => ({
  id: item.productId, product: item.name, size: item.variant ?? "", image: content?.imageUrl ?? item.image, price: item.price,
  description: content?.description ?? "", marker: markerOf(item, content),
});

/**
 * Products & Stocks as the page opens: CREOMS's own copy of the IMS, with no wait on the IMS. The copy is
 * written by `loadStock`, whenever an IMS read succeeds.
 */
export async function loadStockCopy(
  connect: () => postgres.Sql,
  readPublished: ContentReader,
  mirror: StockMirror,
): Promise<StockResult> {
  try {
    const copy = await recall(mirror);
    return { ok: true, page: await buildPage(connect, copy?.feed ?? null, copy?.stock ?? null, readPublished) };
  } catch (error) {
    console.error("Products & stock could not read the ecommerce database", error);
    return { ok: false };
  }
}

/**
 * Reads the IMS now and saves what it says to CREOMS's copy. The IMS stays where stock is owned; CREOMS
 * never sends it a quantity. When the IMS cannot be read the page is built from the copy, silently.
 */
export async function loadStock(
  connect: () => postgres.Sql,
  read: (productIds: number[]) => Promise<Map<number, ImsSizeStock> | null> = readProductStock,
  readFeed: () => Promise<ImsProduct[] | null> = readProductFeed,
  readPublished: ContentReader = noContent,
  mirror?: StockMirror,
): Promise<StockResult> {
  try {
    const liveFeed = await readFeed();
    const liveStock = liveFeed ? await read(liveFeed.map((item) => item.productId)) : null;
    if (liveFeed && liveStock) await remember(() => mirror?.save(liveFeed, liveStock));
    const copy = liveFeed && liveStock ? null : await recall(mirror);
    const feed = liveFeed ?? copy?.feed ?? null;
    const stock = liveStock ?? copy?.stock ?? null;
    return { ok: true, page: await buildPage(connect, feed, stock, readPublished) };
  } catch (error) {
    console.error("Products & stock could not read the ecommerce database", error);
    return { ok: false };
  }
}

async function buildPage(
  connect: () => postgres.Sql,
  feed: ImsProduct[] | null,
  stock: Map<number, ImsSizeStock> | null,
  readPublished: ContentReader,
): Promise<StockPage> {
  if (!feed) return { rows: [], hasStock: false, summary: summarize([]) };
  const published = await readContent(feed.map((item) => item.productId), readPublished);
  const sizes: SizeSource[] = feed
    .map((item) => sizeSource(item, published.get(item.productId)))
    .sort((a, b) => a.product.localeCompare(b.product) || a.id - b.id);
  const holding = await loadHoldingOrders(connect);
  const rows = sizes.map((size) => toRow(size, stock, holding));
  return { rows, hasStock: stock !== null, summary: summarize(rows) };
}

/** The copy is a help for the live read, never a dependency: a failed write is logged and the page carries on. */
async function remember(write: () => Promise<void> | undefined): Promise<void> {
  try { await write(); } catch (error) { console.error("The stock copy could not be written", error); }
}
async function recall(mirror: StockMirror | undefined) {
  try { return (await mirror?.load()) ?? null; }
  catch (error) { console.error("The stock copy could not be read", error); return null; }
}

interface SizeSource { id: number; product: string; size: string; image: string | null; price: number | null; description: string; marker: StockMarker | null }

/** Reserved is CREOMS's own count of what open Orders hold; available is what is physically there less that. */
function toRow(size: SizeSource, stock: Map<number, ImsSizeStock> | null, holding: Map<number, HoldingOrder[]> | null): StockRow {
  const held = stock?.get(size.id);
  const orders = holding?.get(size.id) ?? (holding ? [] : null);
  const reserved = orders ? orders.reduce((sum, order) => sum + order.quantity, 0) : null;
  const inStock = held?.quantity ?? null;
  const available = inStock !== null && reserved !== null ? inStock - reserved : held?.available ?? null;
  return {
    sizeId: size.id, product: size.product, size: size.size, image: size.image, price: size.price, description: size.description, marker: size.marker,
    inStock, reserved, available, shows: shopShows(available), orders,
  };
}

/** The tile figures, from the rows on the page. */
export function summarize(rows: StockRow[]): StockPage["summary"] {
  const live = rows.filter((row) => row.marker === null);
  return {
    sizes: live.length,
    soldOut: live.filter((row) => row.shows === "Sold out").length,
    reserved: rows.reduce((sum, row) => sum + (row.reserved ?? 0), 0),
    low: live.filter((row) => typeof row.shows === "object").length,
  };
}

/** Puts one refetched Size into the page: replaces it, adds a new one in list order, or drops one the IMS no longer lists. */
export function withSize(page: StockPage, sizeId: number, row: StockRow | null): StockPage {
  const rest = page.rows.filter((r) => r.sizeId !== sizeId);
  const rows = row ? [...rest, row].sort((a, b) => a.product.localeCompare(b.product) || a.sizeId - b.sizeId) : rest;
  return { ...page, rows, summary: summarize(rows) };
}

export type StockSizeResult = { ok: true; row: StockRow | null } | { ok: false };

/**
 * One Size, refetched after the IMS announces a change to it. Reads that Size's quantity only. Null row
 * means the IMS no longer lists it. Without the product feed there is no honest row, so it fails and the
 * page keeps what it has.
 */
export async function loadStockSize(
  connect: () => postgres.Sql,
  sizeId: number,
  read: (productIds: number[]) => Promise<Map<number, ImsSizeStock> | null> = readProductStock,
  readFeed: () => Promise<ImsProduct[] | null> = readProductFeed,
  readPublished: ContentReader = noContent,
  mirror?: StockMirror,
): Promise<StockSizeResult> {
  try {
    const feed = await readFeed();
    if (!feed) return { ok: false };
    const item = feed.find((entry) => entry.productId === sizeId);
    if (!item) return { ok: true, row: null };
    const stock = await read([sizeId]);
    if (stock) await remember(() => mirror?.saveOne(item, stock.get(sizeId)));
    const holding = await loadHoldingOrders(connect);
    const published = await readContent([sizeId], readPublished);
    return { ok: true, row: toRow(sizeSource(item, published.get(sizeId)), stock, holding) };
  } catch (error) {
    console.error("A Size could not be refetched", error);
    return { ok: false };
  }
}

/**
 * Per IMS product, the Orders whose open Reservation still holds it. Same rule as the Order detail: a
 * released line, a released Reservation, or an Order that is packed away or cancelled holds nothing.
 */
async function loadHoldingOrders(connect: () => postgres.Sql): Promise<Map<number, HoldingOrder[]> | null> {
  try {
    const found = await connect()<{ order_id: number; customer: string; status: string; size_id: string; quantity: string }[]>`
      select o.id as order_id, ${connect().unsafe(customerNameSql("c"))} as customer, o.status,
        s.ims_product_id as size_id, sum((line->>'quantity')::int) as quantity
      from public.stock_reservations r
      join public.orders o on o.id = r.order_id
      join public.customers c on c.id = o.customer_id
      cross join lateral jsonb_array_elements(r.lines) as line
      join public.sizes s on s.id = (line->>'sizeId')::int and s.ims_product_id is not null
      where r.state = 'placed' and o.status in ('placed', 'confirmed', 'awaiting payment', 'paid', 'preparing')
        and coalesce((line->>'release')::boolean, false) = false and coalesce((line->>'released')::boolean, false) = false
      group by o.id, c.id, o.status, s.ims_product_id
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
