import type postgres from "postgres";
import { COURIERS, type CourierName, type DispatchRecord } from "./dispatch-record";

type Row = { courier: string | null; link: string | null; rider_name: string | null; rider_plate: string | null; rider_phone: string | null };

/**
 * The courier booking of a Delivery Order, or null when it has none (a Pickup Order, or one dispatched before bookings were kept).
 * Rider details are read only when `withRider` is true, so a viewer who may not see them never receives them.
 * Columns are read through JSON so a storefront that has not added them yet simply has no booking.
 */
export async function loadDispatchRecord(sql: postgres.Sql, orderId: number, withRider: boolean): Promise<DispatchRecord | null> {
  const [row] = await sql<Row[]>`
    select to_jsonb(o)->>'courier' as courier, to_jsonb(o)->>'courier_tracking_url' as link,
      ${withRider ? sql`to_jsonb(o)->>'rider_name'` : sql`null`} as rider_name,
      ${withRider ? sql`to_jsonb(o)->>'rider_plate'` : sql`null`} as rider_plate,
      ${withRider ? sql`to_jsonb(o)->>'rider_phone'` : sql`null`} as rider_phone
    from public.orders o where o.id = ${orderId} and o.fulfillment_method = 'delivery'`;
  const courier = COURIERS.find((name): name is CourierName => name === row?.courier);
  if (!row || !courier) return null;
  return {
    courier, trackingUrl: row.link || null,
    rider: withRider ? { name: row.rider_name || null, plate: row.rider_plate || null, phone: row.rider_phone || null } : null,
  };
}
