import type postgres from "postgres";

/** A reference is compared the way the reuse check does: trimmed and case-insensitive. */
export const normaliseReference = (reference: string) => reference.trim().toLowerCase();

/** The latest proof's reference on an Order, normalised; null when there is none. */
export async function latestProofReference(sql: postgres.Sql, orderId: number): Promise<string | null> {
  const [row] = await sql<{ reference: string | null }[]>`select reference from public.order_payment_proofs
    where order_id = ${orderId} order by submitted_at desc, id desc limit 1`;
  const reference = row?.reference ? normaliseReference(row.reference) : "";
  return reference || null;
}

/** Orders that this transfer already moved past payment, so the same transfer would fund a second one. */
export async function alreadyFundedOrderIds(sql: postgres.Sql, orderIds: number[]): Promise<number[]> {
  if (orderIds.length === 0) return [];
  const rows = await sql<{ id: number }[]>`select id from public.orders where id in ${sql(orderIds)}
    and status not in ('placed', 'confirmed', 'awaiting payment', 'cancelled') order by id`;
  return rows.map(r => r.id);
}

export type Allocation = { orderId: number; reason: string; by: { id: string; name: string } };

/**
 * Names the Order a reference pays. The reference is the table's key, so a second Order can never claim it:
 * the answer is the Order that already holds it, or null when this call recorded it.
 */
export async function allocateReference(sql: postgres.Sql, reference: string, allocation: Allocation): Promise<number | null> {
  const [row] = await sql<{ order_id: number }[]>`insert into crms.payment_reference_allocations
    (reference_normalised, order_id, reason, allocated_by_id, allocated_by_name)
    values (${reference}, ${allocation.orderId}, ${allocation.reason}, ${allocation.by.id}, ${allocation.by.name})
    on conflict (reference_normalised) do update set reference_normalised = excluded.reference_normalised
    returning order_id`;
  return Number(row.order_id) === allocation.orderId ? null : Number(row.order_id);
}

/** Frees a reference again when the Order it was claimed for could not be marked paid. */
export async function releaseReference(sql: postgres.Sql, reference: string, orderId: number): Promise<void> {
  await sql`delete from crms.payment_reference_allocations where reference_normalised = ${reference} and order_id = ${orderId}`;
}
