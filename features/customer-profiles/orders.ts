import type postgres from "postgres";

import type { Sentiment } from "@/features/feedback/analysis";

export interface OrderLine {
  product: string;
  size: string;
  quantity: number;
  /** Centavos, per unit. */
  price: number;
}

export interface OrderAddress {
  label: string;
  street: string;
  barangay: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface CustomerOrder {
  id: number;
  createdAt: Date;
  status: string;
  fulfillmentMethod: string;
  paymentMethod: string;
  lines: OrderLine[];
  /** Centavos. */
  subtotal: number;
  /** Centavos; null when the Order has no Delivery fee. */
  deliveryFee: number | null;
  /** Centavos; subtotal plus Delivery fee. */
  total: number;
  /** The Address as it was at checkout, not the Customer's current one. */
  address: OrderAddress | null;
  feedback: { rating: number; comment: string | null; createdAt: Date; sentiment: Sentiment | null } | null;
  /** Only GCash Orders that have submitted proof. */
  paymentProof: { reference: string | null; screenshot: string | null; submittedAt: Date | null } | null;
}

/** The element id an Order card is rendered under, so other tabs can link to it. */
export const orderAnchor = (orderId: number) => `order-${orderId}`;

/** A Customer's Orders, newest first. */
export async function getCustomerOrders(sql: postgres.Sql, customerId: string): Promise<CustomerOrder[]> {
  return fetchOrders(sql, sql`o.customer_id = ${customerId}`);
}

/** One Order with its lines, address, Feedback and Payment proof, or null if there is no such Order. */
export async function getOrderById(sql: postgres.Sql, orderId: number): Promise<CustomerOrder | null> {
  return (await fetchOrders(sql, sql`o.id = ${orderId}`))[0] ?? null;
}

async function fetchOrders(sql: postgres.Sql, where: postgres.PendingQuery<postgres.Row[]>): Promise<CustomerOrder[]> {
  const orders = await sql<Record<string, unknown>[]>`
    select o.id, o.created_at, o.status, o.fulfillment_method, o.payment_method,
      o.subtotal_in_centavos, o.delivery_fee_in_centavos,
      o.gcash_reference_number, o.payment_proof_screenshot_pathname, o.payment_proof_submitted_at,
      a.label as a_label, a.street as a_street, a.barangay as a_barangay, a.city as a_city,
      a.province as a_province, a.postal_code as a_postal_code, a.country as a_country,
      f.rating as f_rating, f.comment as f_comment, f.created_at as f_created_at, f.sentiment as f_sentiment
    from public.orders o
    left join public.order_delivery_addresses a on a.order_id = o.id
    left join public.order_feedback f on f.order_id = o.id
    where ${where}
    order by o.created_at desc, o.id desc`;

  if (orders.length === 0) return [];

  const lines = await sql<Record<string, unknown>[]>`
    select id, order_id, product_name, size_label, price_in_centavos, quantity
    from public.order_lines
    where order_id in ${sql(orders.map((o) => o.id as number))}
    order by id`;

  return orders.map((o) => {
    const subtotal = o.subtotal_in_centavos as number;
    const deliveryFee = (o.delivery_fee_in_centavos as number | null) ?? null;
    const reference = (o.gcash_reference_number as string | null) ?? null;
    const screenshot = (o.payment_proof_screenshot_pathname as string | null) ?? null;
    const submittedAt = (o.payment_proof_submitted_at as Date | null) ?? null;

    return {
      id: o.id as number,
      createdAt: o.created_at as Date,
      status: o.status as string,
      fulfillmentMethod: o.fulfillment_method as string,
      paymentMethod: o.payment_method as string,
      lines: lines
        .filter((l) => l.order_id === o.id)
        .map((l) => ({
          product: l.product_name as string,
          size: l.size_label as string,
          quantity: l.quantity as number,
          price: l.price_in_centavos as number,
        })),
      subtotal,
      deliveryFee,
      total: subtotal + (deliveryFee ?? 0),
      address: o.a_street === undefined || o.a_street === null
        ? null
        : {
            label: o.a_label as string,
            street: o.a_street as string,
            barangay: o.a_barangay as string,
            city: o.a_city as string,
            province: o.a_province as string,
            postalCode: o.a_postal_code as string,
            country: o.a_country as string,
          },
      feedback:
        o.f_rating === null || o.f_rating === undefined
          ? null
          : {
              rating: o.f_rating as number,
              comment: (o.f_comment as string | null) ?? null,
              createdAt: o.f_created_at as Date,
              sentiment: (o.f_sentiment as Sentiment | null) ?? null,
            },
      paymentProof:
        o.payment_method === "gcash" && (reference || screenshot || submittedAt)
          ? { reference, screenshot, submittedAt }
          : null,
    };
  });
}
