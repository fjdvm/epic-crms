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
