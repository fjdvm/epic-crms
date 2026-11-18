import type postgres from "postgres";
import { customerNameSql } from "@/lib/deleted-customer";
import { failedEmails } from "@/features/orders/orders";
import { RETURN_REFUNDED_EMAIL, type FailedEmail } from "@/features/orders/status-emails";
import { DELIVERY_FEE_REASONS } from "./refund-rules";
import { DESTINATION_LOCKED_STATUSES, maskDestination, readDestination, type MaskedRefundDestination } from "./refund-destination";

export const RETURN_STATUSES = ["requested", "approved", "goods received", "refunded", "replaced", "declined", "cancelled"] as const;
export type ReturnResolution = "refund" | "replacement";
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
/** The Returns page's tabs: a Return the Customer cancelled while Requested has none. */
export const RETURN_TABS = ["requested", "approved", "goods received", "refunded", "replaced", "declined"] as const;
export type ReturnTab = (typeof RETURN_TABS)[number];
export interface ReturnQuery { status?: ReturnStatus | "all"; orderId?: number; customerId?: string; page?: number; pageSize?: number }
export interface ReturnItem {
  orderLineId: number; product: string; size: string; quantity: number; price: number;
  /** Set by Staff at inspection; null until the Return is inspected. */
  condition?: "sellable" | "damaged" | null;
  inspectionId?: string | null;
  inspectedBy?: string | null;
  inspectedAt?: Date | null;
  restockedAt?: Date | null;
  writtenOffAt?: Date | null;
}
export interface ReturnRow {
  id: number;
  number: string;
  orderId: number;
  /** `deleted` is true once the storefront has soft-deleted the Customer: no profile link, no contact details. */
  customer: { id: string; name: string; deleted?: boolean };
  status: ReturnStatus;
  preferredResolution: ReturnResolution;
  finalResolution: ReturnResolution | null;
  /** Whether the goods must come back; null until a Manager or Staff decides. Picks the on-screen label of an approved Return. */
  goodsRequired?: boolean | null;
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
  id: number; order_id: number; customer_id: string; full_name: string; deleted: boolean;
  preferred_resolution: ReturnResolution; final_resolution: ReturnResolution | null;
  status: ReturnStatus; requested_at: Date; amount_in_centavos: number; goods_required: boolean | null;
};
function returnRow(row: Row, items: ReturnItem[]): ReturnRow {
  return {
    id: row.id, number: `RMA-${row.id}`, orderId: row.order_id,
    customer: { id: row.customer_id, name: row.full_name, deleted: row.deleted }, status: row.status,
    preferredResolution: row.preferred_resolution, finalResolution: row.final_resolution, goodsRequired: row.goods_required ?? null,
    requestedAt: row.requested_at, amount: row.amount_in_centavos, items,
  };
}
async function itemsFor(sql: postgres.Sql, ids: number[]): Promise<Map<number, ReturnItem[]>> {
  const items = new Map<number, ReturnItem[]>();
  if (ids.length === 0) return items;
  const rows = await sql<{
    return_id: number; order_line_id: number; product_name: string; size_label: string;
    quantity: number; price_in_centavos: number; condition?: "sellable" | "damaged" | null; inspection_id?: string | null;
    inspected_by_name?: string | null; inspected_at?: Date | null; restocked_at?: Date | null; written_off_at?: Date | null;
  }[]>`select * from public.order_return_items where return_id in ${sql(ids)} order by order_line_id`;
  for (const row of rows) {
    const group = items.get(row.return_id) ?? [];
    group.push({ orderLineId: row.order_line_id, product: row.product_name, size: row.size_label,
      quantity: row.quantity, price: row.price_in_centavos, condition: row.condition ?? null, inspectionId: row.inspection_id ?? null,
      inspectedBy: row.inspected_by_name ?? null, inspectedAt: row.inspected_at ?? null, restockedAt: row.restocked_at ?? null,
      writtenOffAt: row.written_off_at ?? null });
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
    const customerId = query.customerId;
    const scope = sql`${orderId === undefined ? sql`` : sql`and r.order_id = ${orderId}`}
      ${customerId === undefined ? sql`` : sql`and o.customer_id = ${customerId}`}`;
    const grouped = await sql<{ status: ReturnStatus; count: number }[]>`
      select r.status, count(*)::int as count from public.order_returns r join public.orders o on o.id = r.order_id
      where true ${scope} group by r.status`;
    const counts = Object.fromEntries(RETURN_STATUSES.map(status => [status, 0])) as Record<ReturnStatus, number>;
    for (const row of grouped) counts[row.status] = row.count;
    const total = status === "all" ? Object.values(counts).reduce((sum, count) => sum + count, 0) : counts[status];
    const pageSize = Math.min(100, positiveInteger(query.pageSize, 25));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(totalPages, positiveInteger(query.page, 1));
    const rows = await sql<Row[]>`
      select r.id, r.order_id, o.customer_id, ${sql.unsafe(customerNameSql('c'))} as full_name, (to_jsonb(c)->>'deleted_at' is not null) as deleted, r.status, r.preferred_resolution, r.final_resolution, r.goods_required, r.requested_at, r.amount_in_centavos
      from public.order_returns r join public.orders o on o.id = r.order_id
      join public.customers c on c.id = o.customer_id
      where true ${scope}
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

/** Most Returns a page that embeds them (an Order, a Customer Profile) shows; the Returns page itself pages. */
export const EMBEDDED_RETURNS_LIMIT = 100;

/** One Order's or one Customer's Returns for embedding in another page; null when they could not be read. */
export async function loadEmbeddedReturns(
  connect: () => postgres.Sql,
  scope: { orderId: number } | { customerId: string },
): Promise<ReturnRow[] | null> {
  const result = await loadReturns(connect, { ...scope, pageSize: EMBEDDED_RETURNS_LIMIT });

  return result.ok ? result.list.rows : null;
}

export interface ReturnStats {
  openReturns: number;
  requestedThisMonth: number;
  deliveredThisMonth: number;
  /** Percentage; zero when there are no delivered Orders in the month. */
  returnRate: number;
  /** Centavos; based on refunded_at, not the request date. */
  refundedThisMonth: number;
  /** Returns marked Replaced this month, by replaced_at. */
  replacedThisMonth: number;
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
    const [totals] = await sql<{ open: number; requested: number; refunded: number; replaced: number }[]>`
      select count(*) filter (where status in ('requested','approved','goods received'))::int as open,
        count(*) filter (where requested_at >= ${start} and requested_at < ${end})::int as requested,
        coalesce(sum(amount_in_centavos + coalesce((to_jsonb(order_returns)->>'refund_delivery_fee_in_centavos')::int, 0)) filter (where status = 'refunded' and refunded_at >= ${start} and refunded_at < ${end}), 0)::bigint as refunded,
        count(*) filter (where status = 'replaced' and replaced_at >= ${start} and replaced_at < ${end})::int as replaced
      from public.order_returns`;
    const [delivered] = await sql<{ count: number }[]>`select count(*)::int as count from public.orders
      where delivered_at >= ${start} and delivered_at < ${end}`;
    return { ok: true, stats: { openReturns: totals.open, requestedThisMonth: totals.requested,
      deliveredThisMonth: delivered.count, returnRate: delivered.count === 0 ? 0 : totals.requested / delivered.count * 100,
      refundedThisMonth: Number(totals.refunded), replacedThisMonth: totals.replaced } };
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
  replacedAt: Date | null;
  videoFileId: string | null;
  refundProofFileId: string | null;
  orderStatus: string;
  paymentMethod: string;
  deliveredAt: Date | null;
  deliveryPhotoFileId: string | null;
  deliveryPhotoRemovedAt: Date | null;
  /** This limits Customer requests only; an existing Return does not expire. */
  refundWindowEndsAt: Date | null;
  /** A Manager may extend the window once by 24 hours; when they did. */
  refundWindowExtendedAt: Date | null;
  /** The ₱0 Replacement Order sent for this Return, once a Manager approved the replacement. */
  replacementOrderId: number | null;
  /** Where the Customer asked the refund to go, number masked; null on a Return that has none. Locked once a Manager approves. */
  refundDestination: MaskedRefundDestination | null;
  refundDestinationLocked: boolean;
  /** What Staff recorded when they marked it Refunded (#613); null before that, and on a refund made before these details existed. */
  refundRecord?: { amountInCentavos: number; method: string; refundedOn: string; reference: string } | null;
  /** What the Order charged for delivery; ₱0 for free delivery or pickup. */
  orderDeliveryFee: number;
  /** The Delivery fee included in this Return's refund (₱0 when only the items were refunded). */
  deliveryFeeRefunded: number;
  /** A Manager may include the Delivery fee: a wrong or defective item, a fee was charged, and none was refunded on the Order yet. */
  deliveryFeeRefundable: boolean;
  /** The Refunded email, when it failed after retries. A failed email never reverses the refund (#617). */
  emailFailures?: FailedEmail[];
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
      refunded_at: Date | null; replaced_at: Date | null; video_file_id: string | null; refund_proof_file_id: string | null; order_status: string; payment_method: string;
      delivered_at: Date | null; delivery_photo_file_id: string | null; delivery_photo_removed_at: string | null;
      window_extended_at: string | null; replacement_order_id: number | null;
      dest_method: string | null; dest_name: string | null; dest_number: string | null; dest_bank: string | null;
      paid_amount: string | null; paid_method: string | null; paid_on: string | null; paid_reference: string | null;
      fulfillment_method: string; order_delivery_fee: number | null; fee_refunded: string | null; fee_refunded_elsewhere: boolean;
    })[]>`select r.*, o.fulfillment_method, o.delivery_fee_in_centavos as order_delivery_fee,
      to_jsonb(r)->>'refund_delivery_fee_in_centavos' as fee_refunded,
      to_jsonb(r)->>'refund_amount_in_centavos' as paid_amount, to_jsonb(r)->>'refund_paid_method' as paid_method,
      to_jsonb(r)->>'refund_paid_on' as paid_on, to_jsonb(r)->>'refund_reference' as paid_reference,
      exists (select 1 from public.order_returns x where x.order_id = r.order_id and x.id <> r.id and x.status = 'refunded'
        and coalesce((to_jsonb(x)->>'refund_delivery_fee_in_centavos')::int, 0) > 0) as fee_refunded_elsewhere,
      to_jsonb(r)->>'refund_method' as dest_method, to_jsonb(r)->>'refund_account_name' as dest_name,
      to_jsonb(r)->>'refund_account_number' as dest_number, to_jsonb(r)->>'refund_bank_name' as dest_bank, o.customer_id, o.status as order_status, o.payment_method, o.delivered_at,
      to_jsonb(o)->>'delivery_photo_file_id' as delivery_photo_file_id,
      to_jsonb(o)->>'delivery_photo_removed_at' as delivery_photo_removed_at,
      to_jsonb(o)->>'refund_window_extended_at' as window_extended_at,
      (select ro.id from public.orders ro where to_jsonb(ro)->>'replacement_for_return_id' = r.id::text limit 1) as replacement_order_id,
      ${sql.unsafe(customerNameSql('c'))} as full_name, (to_jsonb(c)->>'deleted_at' is not null) as deleted from public.order_returns r
      join public.orders o on o.id = r.order_id join public.customers c on c.id = o.customer_id
      where r.id = ${id}`;
    if (!row) return { ok: true, detail: null };
    const items = await itemsFor(sql, [id]);
    const images = await sql<{ file_id: string; position: number }[]>`
      select file_id, position from public.order_return_images where return_id = ${id} order by position`;
    const history = await sql<{
      status: ReturnStatus; actor_type: "staff" | "customer"; actor_id: string; actor_name: string; occurred_at: Date; note: string | null;
    }[]>`select * from public.order_return_history where return_id = ${id} order by occurred_at, id`;
    const emailFailures = row.status === "refunded"
      ? (await failedEmails(sql, row.order_id)).filter((email) => email.kind === RETURN_REFUNDED_EMAIL && email.occurrence === String(id)) : [];
    return { ok: true, detail: {
      ...returnRow(row, items.get(id) ?? []), emailFailures, reason: row.reason, note: row.note,
      videoFileId: row.video_file_id, refundProofFileId: row.refund_proof_file_id, replacedAt: row.replaced_at,
      goodsRequired: row.goods_required, declineReason: row.decline_reason, refundedAt: row.refunded_at,
      orderStatus: row.order_status, paymentMethod: row.payment_method, deliveredAt: row.delivered_at,
      deliveryPhotoFileId: row.delivery_photo_file_id,
      deliveryPhotoRemovedAt: row.delivery_photo_removed_at ? new Date(row.delivery_photo_removed_at) : null,
      refundWindowEndsAt: row.delivered_at ? new Date(row.delivered_at.getTime() + (row.window_extended_at ? 48 : 24) * 60 * 60 * 1000) : null,
      refundWindowExtendedAt: row.window_extended_at ? new Date(row.window_extended_at) : null,
      replacementOrderId: row.replacement_order_id,
      // Masked here, so the full number never reaches a page or a browser from this read.
      refundDestination: (() => { const full = readDestination({ refund_method: row.dest_method, refund_account_name: row.dest_name, refund_account_number: row.dest_number, refund_bank_name: row.dest_bank }); return full ? maskDestination(full) : null; })(),
      refundDestinationLocked: (DESTINATION_LOCKED_STATUSES as readonly string[]).includes(row.status),
      refundRecord: row.paid_amount !== null && row.paid_method && row.paid_on && row.paid_reference
        ? { amountInCentavos: Number(row.paid_amount), method: row.paid_method, refundedOn: row.paid_on.slice(0, 10), reference: row.paid_reference } : null,
      orderDeliveryFee: row.fulfillment_method === "delivery" ? row.order_delivery_fee ?? 0 : 0,
      deliveryFeeRefunded: Number(row.fee_refunded ?? 0),
      deliveryFeeRefundable: row.fulfillment_method === "delivery" && (row.order_delivery_fee ?? 0) > 0 && !row.fee_refunded_elsewhere &&
        (DELIVERY_FEE_REASONS as readonly string[]).includes(row.reason) && row.status !== "refunded",
      images: images.map(image => ({ fileId: image.file_id, position: image.position })),
      history: history.map(step => ({ status: step.status, actor: { type: step.actor_type, id: step.actor_id, name: step.actor_name },
        at: step.occurred_at, note: step.note })),
    } };
  } catch {
    return { ok: false };
  }
}
