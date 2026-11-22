import type postgres from "postgres";

import type { ImsProduct, ImsSizeStock } from "@/lib/storefront";

/** What CREOMS last read from the IMS. The IMS owns physical stock; this is only ever written from an IMS read, and it is what Products & Stocks opens on. */
export interface MirrorSnapshot { feed: ImsProduct[]; stock: Map<number, ImsSizeStock>; syncedAt: Date }

/** The copy as `loadStock` uses it, so `stock.ts` stays free of database code (it is bundled for the browser). */
export interface StockMirror {
  load(): Promise<MirrorSnapshot | null>;
  save(feed: ImsProduct[], stock: Map<number, ImsSizeStock>): Promise<void>;
  saveOne(item: ImsProduct, stock: ImsSizeStock | undefined): Promise<void>;
  /** The IMS no longer lists this Size. */
  deleteOne(productId: number): Promise<void>;
}

interface Row {
  ims_product_id: number; name: string; variant: string | null; image: string | null; price: string | null;
  active: boolean; quantity: number | null; reserved: number | null; available: number | null; synced_at: Date;
}

const toRow = (item: ImsProduct, held: ImsSizeStock | undefined, syncedAt: Date) => ({
  ims_product_id: item.productId, name: item.name, variant: item.variant, image: item.image, price: item.price,
  active: item.active, quantity: held?.quantity ?? null, reserved: held?.reserved ?? null, available: held?.available ?? null, synced_at: syncedAt,
});

/** A product the IMS did not answer for keeps its last quantities; only an answer replaces them. */
const upsert = (sql: postgres.Sql, rows: ReturnType<typeof toRow>[]) => sql`
  insert into crms.stock_mirror ${sql(rows)}
  on conflict (ims_product_id) do update set name = excluded.name, variant = excluded.variant, image = excluded.image,
    price = excluded.price, active = excluded.active,
    quantity = coalesce(excluded.quantity, crms.stock_mirror.quantity),
    reserved = coalesce(excluded.reserved, crms.stock_mirror.reserved),
    available = coalesce(excluded.available, crms.stock_mirror.available),
    synced_at = excluded.synced_at`;

/** A full read of the IMS: upserts every product and drops the ones the IMS no longer lists. An empty feed writes nothing. */
export async function saveMirror(sql: postgres.Sql, feed: ImsProduct[], stock: Map<number, ImsSizeStock>): Promise<void> {
  if (feed.length === 0) return;
  const now = new Date();
  await sql.begin(async (tx) => {
    await upsert(tx as unknown as postgres.Sql, feed.map((item) => toRow(item, stock.get(item.productId), now)));
    await tx`delete from crms.stock_mirror where ims_product_id <> all(${feed.map((item) => item.productId)})`;
  });
}

export async function saveMirrorOne(sql: postgres.Sql, item: ImsProduct, held: ImsSizeStock | undefined): Promise<void> {
  await upsert(sql, [toRow(item, held, new Date())]);
}

export async function deleteMirrorOne(sql: postgres.Sql, productId: number): Promise<void> {
  await sql`delete from crms.stock_mirror where ims_product_id = ${productId}`;
}

/** Null when nothing was ever read from the IMS. */
export async function loadMirror(sql: postgres.Sql): Promise<MirrorSnapshot | null> {
  const rows = await sql<Row[]>`select * from crms.stock_mirror order by ims_product_id`;
  if (rows.length === 0) return null;
  return {
    feed: rows.map((row) => ({
      productId: row.ims_product_id, name: row.name, variant: row.variant, image: row.image,
      price: row.price === null ? null : Number(row.price), active: row.active,
    })),
    stock: new Map(rows.map((row) => [row.ims_product_id, { sizeId: row.ims_product_id, quantity: row.quantity, reserved: row.reserved, available: row.available }])),
    syncedAt: new Date(Math.max(...rows.map((row) => row.synced_at.getTime()))),
  };
}
