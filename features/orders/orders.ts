import { DEFAULT_AUTOMATIC_CHECKS, type AutomaticChecks } from "@/features/settings/automatic-checks";
import { customerNameSql } from "@/lib/deleted-customer";
import { proofAccount, type ProofAccount, type ProofAccountRow } from "./proof-account";
import { paymentProofChecksForOrders, type PaymentProofChecks } from "./payment-proof-checks";
import type postgres from "postgres";

import { getOrderById, type CustomerOrder } from "@/features/customer-profiles/orders";
import { paymentStatusOf } from "@/features/customer-profiles/rules";
import { currentStatus, type IdType, type VerificationStatus } from "@/features/senior-pwd/verifications";
import { safeReason } from "./placement-audit";
import { isOccurrence, isStatusEmailKind, type FailedEmail, type StatusEmailKind } from "./status-emails";
import { freeDeliveryRule, type FreeDeliveryRule } from "./free-delivery";
import { paymentScreenshotSource } from "./payment-screenshot";

export const ORDERS_PAGE_SIZE = 25;

/** The storefront's Order statuses, in the order an Order moves through them. */
export const ORDER_STATUSES = [
  "placed",
  "confirmed",
  "awaiting payment",
  "paid",
  "preparing",
  "dispatched",
  "delivered",
  "received",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Staff may cancel an Order up to `preparing`; nobody can cancel a `dispatched` Order. */
export const CANCELLABLE_STATUSES: readonly string[] = ["placed", "confirmed", "awaiting payment", "paid", "preparing"];

/**
 * "returned" is a filter, not an Order status: it shows the Orders that have a Return, whatever
 * their status. The status tabs are the storefront's own.
 */
export type OrderTab = "all" | OrderStatus | "returned" | "cancel-requests";

/** "cancel-requests" is a filter too: the Orders whose Customer asked to cancel and is waiting for a person to decide. */
export const ORDER_TABS: OrderTab[] = ["all", ...ORDER_STATUSES, "returned", "cancel-requests"];

export type PaymentLabel = ReturnType<typeof paymentStatusOf>;

export interface OrderQuery {
  tab?: OrderTab;
  page?: number;
  pageSize?: number;
}

export interface OrderRow {
  id: number;
  createdAt: Date;
  customerId: string;
  customerName: string;
  lines: { product: string; quantity: number }[];
  /** Centavos; subtotal plus Delivery fee. */
  total: number;
  status: string;
  /** Worked out from the status: there is no stored payment status. */
  paymentLabel: PaymentLabel;
  /** The Customer asked to cancel and a person has yet to decide. */
  cancelRequested?: boolean;
}

export interface OrderList {
  rows: OrderRow[];
  counts: Record<OrderTab, number>;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type OrderListResult = { ok: true; list: OrderList } | { ok: false };

/** The Orders list: every Order, newest first, with a count per status. */
export async function listOrders(sql: postgres.Sql, query: OrderQuery = {}): Promise<OrderList> {
  const tab = query.tab ?? "all";
  const pageSize = query.pageSize ?? ORDERS_PAGE_SIZE;

  const grouped = await sql<{ status: string; count: number }[]>`
    select status, count(*)::int as count from public.orders group by status`;

  const counts = Object.fromEntries(ORDER_TABS.map((t) => [t, 0])) as Record<OrderTab, number>;

  for (const { status, count } of grouped) {
    if (status in counts) counts[status as OrderStatus] = count;
    counts.all += count;
  }

  const [{ returned }] = await sql<{ returned: number }[]>`
    select count(distinct order_id)::int as returned from public.order_returns`;
  counts.returned = returned;

  // Read on its own: if CREOMS cannot read the requests yet, the Orders list still opens, without the filter.
  const waiting = await sql<{ order_id: number }[]>`select order_id from public.order_cancel_requests where status = 'waiting'`.catch((error) => {
    console.error("Orders could not read cancellation requests", error);
    return [] as { order_id: number }[];
  });
  const waitingIds = new Set(waiting.map((w) => w.order_id));
  counts["cancel-requests"] = waitingIds.size;

  const totalPages = Math.max(1, Math.ceil(counts[tab] / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);

  const orders = await sql<Record<string, unknown>[]>`
    select o.id, o.created_at, o.status, o.customer_id, ${sql.unsafe(customerNameSql('c'))} as full_name,
      o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total
    from public.orders o
    join public.customers c on c.id = o.customer_id
    ${
      tab === "all"
        ? sql``
        : tab === "returned"
          ? sql`where exists (select 1 from public.order_returns r where r.order_id = o.id)`
          : tab === "cancel-requests"
            ? sql`where o.id = any(${[...waitingIds]}::int[])`
            : sql`where o.status = ${tab}`
    }
    order by o.created_at desc, o.id desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`;

  const lines =
    orders.length === 0
      ? []
      : await sql<Record<string, unknown>[]>`
          select order_id, product_name, quantity from public.order_lines
          where order_id in ${sql(orders.map((o) => o.id as number))}
          order by id`;

  return {
    rows: orders.map((o) => ({
      id: o.id as number,
      createdAt: o.created_at as Date,
      customerId: o.customer_id as string,
      customerName: o.full_name as string,
      lines: lines
        .filter((l) => l.order_id === o.id)
        .map((l) => ({ product: l.product_name as string, quantity: l.quantity as number })),
      total: o.total as number,
      status: o.status as string,
      paymentLabel: paymentStatusOf(o.status as string),
      cancelRequested: waitingIds.has(o.id as number),
    })),
    counts,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Like listOrders, but an unreachable database becomes `{ ok: false }` so the page can say so in
 * place instead of crashing into the framework's generic error page.
 */
export async function loadOrders(connect: () => postgres.Sql, query: OrderQuery): Promise<OrderListResult> {
  try {
    return { ok: true, list: await listOrders(connect(), query) };
  } catch (error) {
    console.error("Orders could not read the ecommerce database", error);
    return { ok: false };
  }
}

/** One submitted proof, kept for good; a rejected one carries who rejected it and why. */
export interface PaymentProofEntry {
  confirmed?: PaymentProofChecks["confirmed"];
  expected?: PaymentProofChecks["expected"];
  checks?: PaymentProofChecks["checks"];
  id: number;
  reference: string | null;
  screenshot: string | null;
  submittedAt: Date;
  account?: ProofAccount | null;
  rejection: { at: Date; by: { id: string; name: string }; reason: string } | null;
}

/** Every proof the Customer submitted, oldest first, so the history reads in the order it happened. */
export async function paymentProofHistory(sql: postgres.Sql, orderId: number, settings: AutomaticChecks = DEFAULT_AUTOMATIC_CHECKS): Promise<PaymentProofEntry[]> {
  const rows = await sql<({
    id: number; reference: string | null; screenshot_file_id: string | null; screenshot_pathname: string | null; submitted_at: Date;
    rejected_at: Date | null; rejected_by_id: string | null; rejected_by_name: string | null; rejection_reason: string | null;
  } & ProofAccountRow)[]>`select id, reference, screenshot_file_id, screenshot_pathname, submitted_at, rejected_at, rejected_by_id, rejected_by_name, rejection_reason,
    account_id, account_method, account_bank_name, account_label, account_name, account_number
    from public.order_payment_proofs where order_id = ${orderId} order by submitted_at, id`;
  const checks = await paymentProofChecksForOrders(sql, [orderId], settings);
  return rows.map(p => ({
    ...checks.get(p.id),
    id: p.id, reference: p.reference, screenshot: paymentScreenshotSource(orderId, p.screenshot_file_id, p.screenshot_pathname, p.id), submittedAt: p.submitted_at, account: proofAccount(p),
    rejection: p.rejected_at ? { at: p.rejected_at, by: { id: p.rejected_by_id ?? "", name: p.rejected_by_name ?? "" }, reason: p.rejection_reason ?? "" } : null,
  }));
}

export interface OrderDetail extends CustomerOrder {
  /** Every proof and rejection, oldest first. */
  paymentProofs: PaymentProofEntry[];
  paymentLabel: PaymentLabel;
  /** `deleted` is true once the storefront has soft-deleted the Customer: no profile link, no contact details. */
  customer: { id: string; name: string; deleted?: boolean };
  /** Null for legacy Orders and Orders never marked paid. */
  paidBy: { id: string; name: string; at: Date } | null;
  /** The cash a Cash on Delivery Order's completion recorded (amount in centavos, time, Staff); null until then and for every other Order. */
  codCollection: { amountInCentavos: number; at: Date; byName: string } | null;
  /** Who packed the Order and when; null for legacy Orders and Orders not yet packed. */
  packedBy: { id: string; name: string; at: Date } | null;
  /** Null means No photo, including legacy delivered Orders. */
  deliveryPhotoFileId: string | null;
  /** When the retention job removed the photo; null if it never did, so No photo means it never had one. */
  deliveryPhotoRemovedAt: Date | null;
  /** The Senior/PWD verification attached to this Order, as of now; null when the Order has none. */
  seniorPwd?: { id: number; idType: IdType; status: VerificationStatus } | null;
  /** Set only while the confirmation email has failed after retries; the reason never holds an email address. */
  emailFailures?: FailedEmail[];
  /** The storefront's weekly-cap facts for the approved discount; absent until the storefront saves them. Never holds an ID number. */
  discountDetail?: { allowanceUsed: number | null; reductionReason: string | null };
  /** Whether this Order qualifies for free delivery under the rule saved when it was placed (#579); absent when not loaded. */
  freeDelivery?: FreeDeliveryRule;
  /** Added by the Order page (a server file), never by `loadOrder`: this module also reaches the browser. Active Payment accounts that match how the Customer chose to pay (GCash only shows GCash accounts); empty for Cash on Delivery. */
  paymentAccounts?: PaymentAccountOption[];
}

export interface PaymentAccountOption { id: string; label: string; accountName: string; maskedNumber: string }


/** One ID's Senior/PWD discount allowance per week (Monday to Sunday, Philippine Time), in centavos. */
export const SENIOR_PWD_WEEKLY_CAP = 12_500;

export type OrderResult = { ok: true; order: OrderDetail | null } | { ok: false };

/** Status emails that failed after retries, oldest first. A sent, retrying or unknown email is not listed. */
export async function failedEmails(sql: postgres.Sql, orderId: number): Promise<FailedEmail[]> {
  try {
    // `occurrence` is "" for an event that happens once; two rejections are two rows (migration 0053, granted to the read-only role).
    const rows = await sql<{ kind: string; occurrence: string | null; reason: string | null }[]>`
      select e.kind, e.occurrence, e.reason from public.order_email_outcomes e
      where e.order_id = ${orderId} and e.status = 'failed' order by e.updated_at, e.kind`;
    return rows.filter((row) => isStatusEmailKind(row.kind))
      .map((row) => ({ kind: row.kind as StatusEmailKind, occurrence: isOccurrence(row.occurrence) ? row.occurrence : null, reason: safeReason(row.reason) }));
  } catch {
    return [];
  }
}

/** The Order's Senior/PWD verification, or null. Never selects the ID number or its hash. */
async function orderVerification(sql: postgres.Sql, orderId: number): Promise<OrderDetail["seniorPwd"]> {
  try {
    const [row] = await sql<{ id: number; id_type: IdType; status: VerificationStatus; submitted_at: Date; expires_on: string | null }[]>`
      select v.id, v.id_type, v.status, v.submitted_at, to_char(v.expires_on, 'YYYY-MM-DD') as expires_on
      from public.orders o join public.senior_pwd_verifications v on v.id = o.senior_pwd_verification_id
      where o.id = ${orderId}`;
    if (!row) return null;
    const photoExpiresAt = new Date(row.submitted_at.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { id: row.id, idType: row.id_type, status: currentStatus({ status: row.status, expiresOn: row.expires_on, photoExpiresAt }, new Date()) };
  } catch {
    // Before the storefront ships the table, the Order simply has no verification.
    return null;
  }
}

/** One Order with its Customer, or `order: null` if there is no such Order. */
export async function loadOrder(connect: () => postgres.Sql, orderId: number, settings: AutomaticChecks = DEFAULT_AUTOMATIC_CHECKS): Promise<OrderResult> {
  try {
    const sql = connect();
    const order = await getOrderById(sql, orderId);

    if (!order) return { ok: true, order: null };

    const [customer] = await sql<{ id: string; full_name: string; deleted: boolean; paid_by_id: string | null; paid_by_name: string | null; paid_at: Date | null; packed_by_id: string | null; packed_by_name: string | null; packed_at: string | null; delivery_photo_file_id: string | null; delivery_photo_removed_at: string | null; cod_amount: string | null; cod_at: string | null; cod_by_name: string | null; allowance_used: string | null; reduction_reason: string | null; free_delivery: boolean; free_delivery_threshold: number | null }[]>`
      select c.id, ${sql.unsafe(customerNameSql('c'))} as full_name, (to_jsonb(c)->>'deleted_at' is not null) as deleted, o.paid_by_id, o.paid_by_name, o.paid_at,
        to_jsonb(o)->>'packed_by_id' as packed_by_id, to_jsonb(o)->>'packed_by_name' as packed_by_name,
        to_jsonb(o)->>'packed_at' as packed_at,
        to_jsonb(o)->>'cod_collected_amount_in_centavos' as cod_amount, to_jsonb(o)->>'cod_collected_at' as cod_at, to_jsonb(o)->>'cod_collected_by_name' as cod_by_name,
        to_jsonb(o)->>'delivery_photo_file_id' as delivery_photo_file_id,
        to_jsonb(o)->>'delivery_photo_removed_at' as delivery_photo_removed_at,
        to_jsonb(o)->>'senior_pwd_allowance_used_in_centavos' as allowance_used,
        to_jsonb(o)->>'discount_reduction_reason' as reduction_reason,
        coalesce((to_jsonb(o)->>'free_delivery')::boolean, false) as free_delivery,
        (to_jsonb(o)->>'free_delivery_threshold_in_centavos')::bigint::float8 as free_delivery_threshold from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.id = ${orderId}`;

    return {
      ok: true,
      order: {
        ...order,
        paymentProofs: await paymentProofHistory(sql, orderId, settings),
        paymentLabel: paymentStatusOf(order.status),
        packedBy: customer.packed_by_id && customer.packed_by_name && customer.packed_at
          ? { id: customer.packed_by_id, name: customer.packed_by_name, at: new Date(customer.packed_at) }
          : null,
        deliveryPhotoFileId: customer.delivery_photo_file_id,
        deliveryPhotoRemovedAt: customer.delivery_photo_removed_at ? new Date(customer.delivery_photo_removed_at) : null,
        freeDelivery: await freeDeliveryRule(sql, { freeDelivery: customer.free_delivery, thresholdInCentavos: customer.free_delivery_threshold }, order.subtotal - order.discount),
        seniorPwd: await orderVerification(sql, orderId),
        emailFailures: await failedEmails(sql, orderId),
        discountDetail: {
          allowanceUsed: customer.allowance_used === null || !Number.isSafeInteger(Number(customer.allowance_used)) ? null : Number(customer.allowance_used),
          reductionReason: customer.reduction_reason?.trim() || null,
        },
        customer: { id: customer.id, name: customer.full_name, deleted: customer.deleted },
        codCollection: customer.cod_amount !== null && customer.cod_at && customer.cod_by_name && Number.isSafeInteger(Number(customer.cod_amount))
          ? { amountInCentavos: Number(customer.cod_amount), at: new Date(customer.cod_at), byName: customer.cod_by_name }
          : null,
        paidBy: customer.paid_by_id && customer.paid_by_name && customer.paid_at
          ? { id: customer.paid_by_id, name: customer.paid_by_name, at: customer.paid_at }
          : null,
      },
    };
  } catch (error) {
    console.error("Orders could not read the ecommerce database", error);
    return { ok: false };
  }
}
