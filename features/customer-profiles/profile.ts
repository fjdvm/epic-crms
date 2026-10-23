import type postgres from "postgres";

import { getCustomerCart, type Cart } from "./cart";
import { getCustomerOrders, type CustomerOrder } from "./orders";
import { listEmailsReceived, type EmailReceived } from "@/features/marketing/announcements";
import { crmsDatabase } from "@/lib/crms-db";

import { PAID_OR_FULFILLED, stageOf, type Stage } from "./rules";
import { getMergedWalkIn, getWalkIn, isWalkInId, type MergedWalkIn, type WalkInProfileData } from "./walk-ins";

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
  /** Centavos; net Total spent over the original paid/fulfilled Order count. Null with none. */
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
  /** Marketing Emails this Customer was sent, newest first. Null when CREOMS could not read them. */
  emailsReceived: EmailReceived[] | null;
  /** Tags and internal notes carried over from the Walk-in Customer this Customer used to be. */
  mergedWalkIn: MergedWalkIn | null;
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
                          then subtotal_in_centavos + coalesce(delivery_fee_in_centavos, 0)
                            - coalesce((select sum(r.amount_in_centavos) from public.order_returns r
                                where r.order_id = customer_order.id and r.status = 'refunded'), 0) end), 0)::bigint as total_spent,
        (count(*) filter (where status = any(${PAID_OR_FULFILLED})))::int as paid_orders,
        (count(*) filter (where status <> 'cancelled'))::int as stage_orders,
        max(created_at) filter (where status <> 'cancelled') as last_order
      from public.orders customer_order where customer_order.customer_id = c.id
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
    emailsReceived: [],
    mergedWalkIn: null,
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
    emailsReceived: [],
    mergedWalkIn: null,
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

    const profile = await getCustomerProfile(connect(), id);
    if (profile) {
      profile.mergedWalkIn = await readMergedWalkIn(connectCrms, profile.email);
      profile.emailsReceived = await readEmailsReceived(connectCrms, profile.id);
    }

    return { ok: true, profile };
  } catch (error) {
    console.error("Customer Profile could not read the ecommerce database", error);
    return { ok: false };
  }
}

/** Walk-in data is CREOMS's own: if it cannot be read, the Customer's profile still opens without it. */
async function readMergedWalkIn(connectCrms: () => postgres.Sql, email: string): Promise<MergedWalkIn | null> {
  try {
    return await getMergedWalkIn(connectCrms(), email);
  } catch (error) {
    console.error("Customer Profile could not read the merged Walk-in Customer", error);
    return null;
  }
}

/** Announcements are CREOMS's own data: if they cannot be read, the profile still opens and the tab says so. */
async function readEmailsReceived(connectCrms: () => postgres.Sql, customerId: string): Promise<EmailReceived[] | null> {
  try {
    return await listEmailsReceived(connectCrms(), customerId);
  } catch (error) {
    console.error("Customer Profile could not read the Emails received", error);
    return null;
  }
}
