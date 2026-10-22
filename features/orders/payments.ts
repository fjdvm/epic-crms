import type postgres from "postgres";

export interface PaymentQueueOrder {
  id: number;
  createdAt: Date;
  customer: { id: string; name: string };
  /** Centavos, including the Delivery fee. */
  total: number;
  paymentProof: { reference: string | null; screenshot: string | null; submittedAt: Date };
}

export type PaymentQueueResult = { ok: true; orders: PaymentQueueOrder[] } | { ok: false; reason: string };

/** Oldest submitted proof first; a screenshot is optional, and ties use the Order number. */
export async function paymentQueue(sql: postgres.Sql): Promise<PaymentQueueOrder[]> {
  const rows = await sql<{
    id: number; created_at: Date; customer_id: string; full_name: string; total: number;
    gcash_reference_number: string | null; payment_proof_screenshot_pathname: string | null;
    payment_proof_submitted_at: Date;
  }[]>`
    select o.id, o.created_at, o.customer_id, c.full_name,
      o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total,
      o.gcash_reference_number, o.payment_proof_screenshot_pathname, o.payment_proof_submitted_at
    from public.orders o join public.customers c on c.id = o.customer_id
    where o.payment_method = 'gcash' and o.status = 'awaiting payment'
      and o.payment_proof_submitted_at is not null
    order by o.payment_proof_submitted_at asc, o.id asc`;

  return rows.map(o => ({
    id: o.id, createdAt: o.created_at,
    customer: { id: o.customer_id, name: o.full_name }, total: o.total,
    paymentProof: {
      reference: o.gcash_reference_number, screenshot: o.payment_proof_screenshot_pathname,
      submittedAt: o.payment_proof_submitted_at,
    },
  }));
}

export type PaymentMethod = "gcash" | "cash-on-delivery";

/** One GCash Order with proof, or one Cash on Delivery Order: everything the Payments page counts. */
export interface PaymentRow {
  id: number;
  customer: { id: string; name: string };
  method: PaymentMethod;
  status: string;
  /** Centavos, including the Delivery fee. */
  total: number;
  /** Null for Cash on Delivery, which has no proof. */
  proof: { reference: string | null; screenshot: string | null; submittedAt: Date } | null;
}

export type PaymentsResult = { ok: true; rows: PaymentRow[]; now: Date } | { ok: false; reason: string };

/** Days of settled Orders (paid, collected, rejected) the page keeps counting. */
export const PAYMENTS_WINDOW_DAYS = 30;

const ACTIVE = ["awaiting payment", "confirmed", "preparing", "dispatched"];

/** Open work at any age, plus everything created in the window. */
export async function paymentRows(sql: postgres.Sql, now: Date = new Date()): Promise<PaymentRow[]> {
  const since = new Date(now.getTime() - PAYMENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await sql<{
    id: number; customer_id: string; full_name: string; payment_method: PaymentMethod; status: string; total: number;
    gcash_reference_number: string | null; payment_proof_screenshot_pathname: string | null;
    payment_proof_submitted_at: Date | null;
  }[]>`
    select o.id, o.customer_id, c.full_name, o.payment_method, o.status,
      o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total,
      o.gcash_reference_number, o.payment_proof_screenshot_pathname, o.payment_proof_submitted_at
    from public.orders o join public.customers c on c.id = o.customer_id
    where ((o.payment_method = 'gcash' and o.payment_proof_submitted_at is not null)
        or o.payment_method = 'cash-on-delivery')
      and (o.status in ${sql(ACTIVE)} or o.created_at >= ${since})
    order by o.id`;

  return rows.map(o => ({
    id: o.id, customer: { id: o.customer_id, name: o.full_name }, method: o.payment_method, status: o.status,
    total: o.total,
    proof: o.payment_proof_submitted_at
      ? { reference: o.gcash_reference_number, screenshot: o.payment_proof_screenshot_pathname, submittedAt: o.payment_proof_submitted_at }
      : null,
  }));
}

export type PaymentTab = "verify" | "cod" | "paid" | "rejected";

const GCASH_PAID = ["paid", "preparing", "dispatched", "delivered"];
const COD_OPEN = ["confirmed", "preparing", "dispatched"];

/** GCash proof waiting for a check. */
export const awaitingCheck = (r: PaymentRow): boolean =>
  r.method === "gcash" && r.status === "awaiting payment" && r.proof !== null;
/** Cash on Delivery the courier has not yet handed back as delivered. */
export const codToCollect = (r: PaymentRow): boolean => r.method === "cash-on-delivery" && COD_OPEN.includes(r.status);
/** Money in: GCash accepted, or Cash on Delivery collected on delivery. */
export const settled = (r: PaymentRow): boolean =>
  r.method === "gcash" ? GCASH_PAID.includes(r.status) : r.status === "delivered";
/** A GCash Order Staff cancelled after the Customer sent proof. */
export const rejected = (r: PaymentRow): boolean => r.method === "gcash" && r.status === "cancelled" && r.proof !== null;

/** The page's tabs and stat cards, all derived from the rows so an optimistic change moves both. */
export function summarize(rows: PaymentRow[], now: Date) {
  const verify = rows.filter(awaitingCheck).sort((a, b) => a.proof!.submittedAt.getTime() - b.proof!.submittedAt.getTime() || a.id - b.id);
  const tabs: Record<PaymentTab, PaymentRow[]> = {
    verify,
    cod: rows.filter(codToCollect),
    paid: rows.filter(settled).sort((a, b) => b.id - a.id),
    rejected: rows.filter(rejected).sort((a, b) => b.id - a.id),
  };
  const sum = (list: PaymentRow[]) => list.reduce((total, r) => total + r.total, 0);
  const collected = rows.filter((r) => r.method === "cash-on-delivery" && r.status === "delivered");
  const gcashPaid = tabs.paid.filter((r) => r.method === "gcash");

  return {
    tabs,
    oldestProof: verify[0]?.proof!.submittedAt ?? null,
    paid: { count: tabs.paid.length, centavos: sum(tabs.paid) },
    gcashPaid: { count: gcashPaid.length, centavos: sum(gcashPaid) },
    collected: { count: collected.length, centavos: sum(collected) },
    toCollect: { count: tabs.cod.length, centavos: sum(tabs.cod) },
    rejected: { count: tabs.rejected.length, centavos: sum(tabs.rejected) },
    now,
  };
}
