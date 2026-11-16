import type postgres from "postgres";

export interface PaymentProofChecks {
  confirmed: { amountInCentavos: number | null; paidAt: Date | null; recipient: string | null };
  expected: { amountInCentavos: number; placedAt: Date; recipient: string | null };
  checks: {
    amount: { pass: boolean; reason: string };
    date: { pass: boolean; reason: string };
    recipient: { pass: boolean; reason: string };
    reference: { pass: boolean; reason: string; otherOrderIds: number[] };
  };
}

/** Account identifiers are compared without display spaces/dashes; names are case insensitive. */
const account = (value: string) => value.trim().toLowerCase().replace(/[\s-]/g, "");

/** Read-only rules: a failed check never rejects a proof or changes an Order. */
export async function paymentProofChecksForOrders(sql: postgres.Sql, orderIds: number[]): Promise<Map<number, PaymentProofChecks>> {
  if (orderIds.length === 0) return new Map();
  const rows = await sql<{
    id: number; other_order_ids: number[];
    order_id: number; reference: string | null; confirmed_amount_in_centavos: number | null;
    confirmed_paid_at: Date | null; confirmed_recipient: string | null; expected_recipient: string | null;
    total: number; created_at: Date;
  }[]>`select p.id, p.order_id, p.reference, p.confirmed_amount_in_centavos, p.confirmed_paid_at,
    p.confirmed_recipient, p.expected_recipient, o.created_at,
    o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total,
    array(select distinct other_order.id from public.orders other_order
      where other_order.id <> p.order_id and nullif(trim(p.reference), '') is not null and (
        lower(trim(other_order.gcash_reference_number)) = lower(trim(p.reference))
        or exists (select 1 from public.order_payment_proofs other where other.order_id = other_order.id
          and lower(trim(other.reference)) = lower(trim(p.reference)))) order by other_order.id) as other_order_ids
    from public.order_payment_proofs p join public.orders o on o.id = p.order_id
    where p.order_id in ${sql(orderIds)} order by p.submitted_at, p.id`;
  return new Map(rows.map(p => [p.id, compare(p)]));
}

function compare(p: {
  reference: string | null; confirmed_amount_in_centavos: number | null; confirmed_paid_at: Date | null;
  confirmed_recipient: string | null; expected_recipient: string | null; total: number; created_at: Date; other_order_ids: number[];
}): PaymentProofChecks {
  const amount = p.confirmed_amount_in_centavos !== null && p.confirmed_amount_in_centavos === p.total;
  const date = p.confirmed_paid_at !== null && p.confirmed_paid_at.getTime() > p.created_at.getTime();
  const recipient = Boolean(p.confirmed_recipient?.trim() && p.expected_recipient?.trim()
    && account(p.confirmed_recipient) === account(p.expected_recipient));
  const otherOrderIds = p.other_order_ids;
  return {
    confirmed: { amountInCentavos: p.confirmed_amount_in_centavos, paidAt: p.confirmed_paid_at, recipient: p.confirmed_recipient },
    expected: { amountInCentavos: p.total, placedAt: p.created_at, recipient: p.expected_recipient },
    checks: {
      amount: { pass: amount, reason: p.confirmed_amount_in_centavos === null ? "Customer-confirmed amount is missing." : amount ? "Amount matches the Order total." : "Amount does not match the Order total." },
      date: { pass: date, reason: p.confirmed_paid_at === null ? "Customer-confirmed payment date is missing." : date ? "Payment date is after the Order was placed." : "Payment date is not after the Order was placed." },
      recipient: { pass: recipient, reason: !p.confirmed_recipient?.trim() ? "Customer-confirmed recipient is missing." : !p.expected_recipient?.trim() ? "Shop account was not available when this proof was submitted. Check manually." : recipient ? "Recipient matches the shop account." : "Recipient does not match the shop account." },
      reference: { pass: Boolean(p.reference?.trim()) && otherOrderIds.length === 0, otherOrderIds,
        reason: !p.reference?.trim() ? "Payment reference is missing." : otherOrderIds.length ? `Reference also used on ${otherOrderIds.map(id => `Order #${id}`).join(", ")}.` : "Reference is not used on another Order." },
    },
  };
}
