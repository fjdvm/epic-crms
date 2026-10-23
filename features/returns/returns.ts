import type postgres from "postgres";

export const RETURN_STATUSES = ["requested", "approved", "goods received", "refunded", "declined", "cancelled"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
/** The Returns page's tabs: a Return the Customer cancelled while Requested has none. */
export const RETURN_TABS = ["requested", "approved", "goods received", "refunded", "declined"] as const;
export type ReturnTab = (typeof RETURN_TABS)[number];
export interface ReturnQuery { status?: ReturnStatus | "all"; orderId?: number; page?: number; pageSize?: number }
export interface ReturnItem { orderLineId: number; product: string; size: string; quantity: number; price: number }
export interface ReturnRow {
  id: number;
  number: string;
  orderId: number;
  customer: { id: string; name: string };
  status: ReturnStatus;
  requestedAt: Date;
  /** Centavos, captured by the storefront when the Customer requests the Return. */
  amount: number;
  items: ReturnItem[];
}
export interface ReturnList {
  rows: ReturnRow[];
  counts: Record<ReturnStatus, number>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export type ReturnListResult = { ok: true; list: ReturnList } | { ok: false };

type Row = {
  id: number; order_id: number; customer_id: string; full_name: string;
  status: ReturnStatus; requested_at: Date; amount_in_centavos: number;
};
function returnRow(row: Row, items: ReturnItem[]): ReturnRow {
  return {
    id: row.id, number: `RMA-${row.id}`, orderId: row.order_id,
    customer: { id: row.customer_id, name: row.full_name }, status: row.status,
    requestedAt: row.requested_at, amount: row.amount_in_centavos, items,
  };
}
async function itemsFor(sql: postgres.Sql, ids: number[]): Promise<Map<number, ReturnItem[]>> {
  const items = new Map<number, ReturnItem[]>();
  if (ids.length === 0) return items;
  const rows = await sql<{
    return_id: number; order_line_id: number; product_name: string; size_label: string;
    quantity: number; price_in_centavos: number;
  }[]>`select * from public.order_return_items where return_id in ${sql(ids)} order by order_line_id`;
  for (const row of rows) {
    const group = items.get(row.return_id) ?? [];
    group.push({ orderLineId: row.order_line_id, product: row.product_name, size: row.size_label,
      quantity: row.quantity, price: row.price_in_centavos });
    items.set(row.return_id, group);
  }
  return items;
}
const positiveInteger = (value: number | undefined, fallback: number) =>
  Number.isSafeInteger(value) && value! > 0 ? value! : fallback;

/** Read-only integration: the storefront owns these tables and all Return writes. */
export async function loadReturns(connect: () => postgres.Sql, query: ReturnQuery = {}): Promise<ReturnListResult> {
  try {
    const sql = connect();
    const orderId = query.orderId;
    if (orderId !== undefined && (!Number.isSafeInteger(orderId) || orderId < 1)) return { ok: false };
    const status = RETURN_STATUSES.includes(query.status as ReturnStatus) ? query.status as ReturnStatus : "all";
    const grouped = await sql<{ status: ReturnStatus; count: number }[]>`
      select status, count(*)::int as count from public.order_returns
      ${orderId === undefined ? sql`` : sql`where order_id = ${orderId}`} group by status`;
    const counts = Object.fromEntries(RETURN_STATUSES.map(status => [status, 0])) as Record<ReturnStatus, number>;
    for (const row of grouped) counts[row.status] = row.count;
    const total = status === "all" ? Object.values(counts).reduce((sum, count) => sum + count, 0) : counts[status];
    const pageSize = Math.min(100, positiveInteger(query.pageSize, 25));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(totalPages, positiveInteger(query.page, 1));
    const rows = await sql<Row[]>`
      select r.id, r.order_id, o.customer_id, c.full_name, r.status, r.requested_at, r.amount_in_centavos
      from public.order_returns r join public.orders o on o.id = r.order_id
      join public.customers c on c.id = o.customer_id
      where true ${orderId === undefined ? sql`` : sql`and r.order_id = ${orderId}`}
        ${status === "all" ? sql`` : sql`and r.status = ${status}`}
      order by (r.status = 'requested') desc, r.requested_at, r.id
      limit ${pageSize} offset ${(page - 1) * pageSize}`;
    const items = await itemsFor(sql, rows.map(row => row.id));
    return { ok: true, list: { rows: rows.map(row => returnRow(row, items.get(row.id) ?? [])),
      counts, page, pageSize, total, totalPages } };
  } catch {
    return { ok: false };
  }
}

export interface ReturnStats {
  openReturns: number;
  requestedThisMonth: number;
  deliveredThisMonth: number;
  /** Percentage; zero when there are no delivered Orders in the month. */
  returnRate: number;
  /** Centavos; based on refunded_at, not the request date. */
  refundedThisMonth: number;
}
export type ReturnStatsResult = { ok: true; stats: ReturnStats } | { ok: false };

/** Calendar months follow the store's Philippine time, including Orders subsequently marked received. */
export async function loadReturnStats(connect: () => postgres.Sql, now = new Date()): Promise<ReturnStatsResult> {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric", month: "numeric" }).formatToParts(now);
    const year = Number(parts.find(part => part.type === "year")!.value);
    const month = Number(parts.find(part => part.type === "month")!.value) - 1;
    const start = new Date(Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000);
    const end = new Date(Date.UTC(year, month + 1, 1) - 8 * 60 * 60 * 1000);
    const sql = connect();
    const [totals] = await sql<{ open: number; requested: number; refunded: number }[]>`
      select count(*) filter (where status in ('requested','approved','goods received'))::int as open,
        count(*) filter (where requested_at >= ${start} and requested_at < ${end})::int as requested,
        coalesce(sum(amount_in_centavos) filter (where status = 'refunded' and refunded_at >= ${start} and refunded_at < ${end}), 0)::bigint as refunded
      from public.order_returns`;
    const [delivered] = await sql<{ count: number }[]>`select count(*)::int as count from public.orders
      where delivered_at >= ${start} and delivered_at < ${end}`;
    return { ok: true, stats: { openReturns: totals.open, requestedThisMonth: totals.requested,
      deliveredThisMonth: delivered.count, returnRate: delivered.count === 0 ? 0 : totals.requested / delivered.count * 100,
      refundedThisMonth: Number(totals.refunded) } };
  } catch {
    return { ok: false };
  }
}

export interface ReturnDetail extends ReturnRow {
  reason: "damaged" | "defective" | "wrong item" | "other";
  note: string;
  goodsRequired: boolean | null;
  declineReason: string | null;
  refundedAt: Date | null;
  orderStatus: string;
  paymentMethod: string;
  deliveredAt: Date | null;
  deliveryPhotoFileId: string | null;
  /** This limits Customer requests only; an existing Return does not expire. */
  refundWindowEndsAt: Date | null;
  images: { fileId: string; position: number }[];
  history: { status: ReturnStatus; actor: { type: "staff" | "customer"; id: string; name: string }; at: Date; note: string | null }[];
}
export type ReturnDetailResult = { ok: true; detail: ReturnDetail | null } | { ok: false };

export async function loadReturnDetail(connect: () => postgres.Sql, id: number): Promise<ReturnDetailResult> {
  if (!Number.isSafeInteger(id) || id < 1) return { ok: true, detail: null };
  try {
    const sql = connect();
    const [row] = await sql<(Row & {
      reason: ReturnDetail["reason"]; note: string; goods_required: boolean | null; decline_reason: string | null;
      refunded_at: Date | null; order_status: string; payment_method: string;
      delivered_at: Date | null; delivery_photo_file_id: string | null;
    })[]>`select r.*, o.customer_id, o.status as order_status, o.payment_method, o.delivered_at,
      to_jsonb(o)->>'delivery_photo_file_id' as delivery_photo_file_id, c.full_name from public.order_returns r
      join public.orders o on o.id = r.order_id join public.customers c on c.id = o.customer_id
      where r.id = ${id}`;
    if (!row) return { ok: true, detail: null };
    const items = await itemsFor(sql, [id]);
    const images = await sql<{ file_id: string; position: number }[]>`
      select file_id, position from public.order_return_images where return_id = ${id} order by position`;
    const history = await sql<{
      status: ReturnStatus; actor_type: "staff" | "customer"; actor_id: string; actor_name: string; occurred_at: Date; note: string | null;
    }[]>`select * from public.order_return_history where return_id = ${id} order by occurred_at, id`;
    return { ok: true, detail: {
      ...returnRow(row, items.get(id) ?? []), reason: row.reason, note: row.note,
      goodsRequired: row.goods_required, declineReason: row.decline_reason, refundedAt: row.refunded_at,
      orderStatus: row.order_status, paymentMethod: row.payment_method, deliveredAt: row.delivered_at,
      deliveryPhotoFileId: row.delivery_photo_file_id,
      refundWindowEndsAt: row.delivered_at ? new Date(row.delivered_at.getTime() + 24 * 60 * 60 * 1000) : null,
      images: images.map(image => ({ fileId: image.file_id, position: image.position })),
      history: history.map(step => ({ status: step.status, actor: { type: step.actor_type, id: step.actor_id, name: step.actor_name },
        at: step.occurred_at, note: step.note })),
    } };
  } catch {
    return { ok: false };
  }
}
