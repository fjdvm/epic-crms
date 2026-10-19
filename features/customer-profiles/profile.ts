import type postgres from "postgres";

import { getCustomerCart, type Cart } from "./cart";
import { getCustomerOrders, type CustomerOrder } from "./orders";
import { crmsDatabase } from "@/lib/crms-db";

import { PAID_OR_FULFILLED, stageOf, type Stage } from "./rules";
import { getWalkIn, isWalkInId, type WalkInProfileData } from "./walk-ins";

export interface CustomerAddress {
  id: number;
  label: string;
  street: string;
  barangay: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export interface CustomerProfile {
  id: string;
  name: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  contactNumber: string;
  marketingOptIn: boolean;
  customerSince: Date;
  stage: Stage;
  /** City of the Default address, if the Customer has one. */
  defaultCity: string | null;
  orders: number;
  /** Centavos. */
  totalSpent: number;
  /** Centavos; Total spent over the paid or fulfilled Orders. Null with none. */
  averageOrder: number | null;
  /** Latest non-cancelled Order. */
  lastOrder: Date | null;
  feedbackCount: number;
  averageRating: number | null;
  addresses: CustomerAddress[];
  /** Newest first. */
  orderHistory: CustomerOrder[];
  cart: Cart;
  /** Set for a Walk-in Customer: the fields Staff entered. Such a profile has no storefront Orders or Cart. */
  walkIn: WalkInProfileData | null;
}

/** One verified Customer's Profile, or null for a Lead or an id that does not exist. */
export async function getCustomerProfile(
  sql: postgres.Sql,
  id: string,
  now: Date = new Date(),
): Promise<CustomerProfile | null> {
  const [row] = await sql<Record<string, unknown>[]>`
    select
      c.id, c.full_name, c.first_name, c.middle_name, c.last_name, c.email, c.contact_number,
      c.marketing_opt_in, u."createdAt" as customer_since,
      o.orders, o.total_spent, o.paid_orders, o.stage_orders, o.last_order,
      f.feedback_count, f.average_rating
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
    cross join lateral (
      select
        count(*)::int as orders,
        coalesce(sum(case when status = any(${PAID_OR_FULFILLED})
                          then subtotal_in_centavos + coalesce(delivery_fee_in_centavos, 0) end), 0)::bigint as total_spent,
        (count(*) filter (where status = any(${PAID_OR_FULFILLED})))::int as paid_orders,
        (count(*) filter (where status <> 'cancelled'))::int as stage_orders,
        max(created_at) filter (where status <> 'cancelled') as last_order
      from public.orders where customer_id = c.id
    ) o
    cross join lateral (
      select count(*)::int as feedback_count, avg(ff.rating)::float8 as average_rating
      from public.order_feedback ff
      join public.orders oo on oo.id = ff.order_id
      where oo.customer_id = c.id
    ) f
    where c.id = ${id}`;

  if (!row) return null;

  const addresses = await sql<Record<string, unknown>[]>`
    select id, label, street, barangay, city, province, postal_code, country, is_default
    from public.addresses where customer_id = ${id} order by id`;

  const orderHistory = await getCustomerOrders(sql, id);
  const cart = await getCustomerCart(sql, id);

  const totalSpent = Number(row.total_spent);
  const paidOrders = row.paid_orders as number;
  const lastOrder = (row.last_order as Date | null) ?? null;

  const mapped = addresses.map((a) => ({
    id: a.id as number,
    label: a.label as string,
    street: a.street as string,
    barangay: a.barangay as string,
    city: a.city as string,
    province: a.province as string,
    postalCode: a.postal_code as string,
    country: a.country as string,
    isDefault: a.is_default as boolean,
  }));

  return {
    id: row.id as string,
    name: row.full_name as string,
    firstName: row.first_name as string,
    middleName: (row.middle_name as string | null) ?? null,
    lastName: row.last_name as string,
    email: row.email as string,
    contactNumber: row.contact_number as string,
    marketingOptIn: row.marketing_opt_in as boolean,
    customerSince: row.customer_since as Date,
    stage: stageOf({ orders: row.stage_orders as number, lastOrder }, now),
    defaultCity: mapped.find((a) => a.isDefault)?.city ?? null,
    orders: row.orders as number,
    totalSpent,
    averageOrder: paidOrders ? Math.round(totalSpent / paidOrders) : null,
    lastOrder,
    feedbackCount: row.feedback_count as number,
    averageRating: (row.average_rating as number | null) ?? null,
    addresses: mapped,
    orderHistory,
    cart,
    walkIn: null,
  };
}

/** A Walk-in Customer's profile: the entered fields, a New Stage, and empty Orders, Cart and Feedback. */
export function walkInProfile(w: WalkInProfileData): CustomerProfile {
  return {
    id: w.id,
    name: w.name,
    firstName: w.firstName,
    middleName: null,
    lastName: w.lastName,
    email: w.email ?? "No email",
    contactNumber: w.mobile,
    marketingOptIn: w.emailConsent,
    customerSince: w.createdAt,
    stage: stageOf({ orders: 0, lastOrder: null }, new Date()),
    defaultCity: w.address?.city || null,
    orders: 0,
    totalSpent: 0,
    averageOrder: null,
    lastOrder: null,
    feedbackCount: 0,
    averageRating: null,
    addresses: [],
    orderHistory: [],
    cart: { lines: [], total: 0 },
    walkIn: w,
  };
}

export type CustomerProfileResult =
  { ok: true; profile: CustomerProfile | null } | { ok: false };

/** Like getCustomerProfile, but an unreachable database becomes `{ ok: false }` so the page can say so. */
export async function loadCustomerProfile(
  connect: () => postgres.Sql,
  id: string,
  connectCrms: () => postgres.Sql = crmsDatabase,
): Promise<CustomerProfileResult> {
  try {
    if (isWalkInId(id)) {
      const walkIn = await getWalkIn(connectCrms(), id);

      return { ok: true, profile: walkIn ? walkInProfile(walkIn) : null };
    }

    return { ok: true, profile: await getCustomerProfile(connect(), id) };
  } catch (error) {
    console.error("Customer Profile could not read the ecommerce database", error);
    return { ok: false };
  }
}
