import { syncCancellationRequests } from "@/features/orders/cancellation-sync";
import { syncPortalCopies } from "./portal-copies";
import { portalGateway } from "./portal-gateway";
import type postgres from "postgres";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { ticketsDatabase } from "@/lib/tickets-db";
import { readCustomers, syncNewCustomers, type SyncResult } from "./notifications";
import { syncTicketEvents } from "./ticket-events";
import { syncFeedbackEvents } from "./feedback-events";
import { syncOrderEvents } from "./order-events";
import { syncOrderAudit } from "@/features/orders/placement-audit";
import { deliverGatewayAuditEvent } from "@/lib/gateway";
import { fetchReturnPhoto } from "@/features/returns/photo-bytes";
import { fingerprintReturnPhotos } from "@/features/returns/return-flags";
import { syncReturnEvents } from "./return-events";

type Connection = () => postgres.Sql;

/** Keeps each new Return photo's similar-image fingerprint; a few per sync, and never fails the sync. */
export async function fingerprintNewReturnPhotos(writer: postgres.Sql, reader: postgres.Sql) {
  await fingerprintReturnPhotos(reader, writer, fetchReturnPhoto, undefined, 10)
    .catch((error) => console.error("Return photo fingerprinting failed", error));
}
export type SyncBatch = Record<"customers" | "tickets" | "feedback" | "orders" | "returns" | "cancellations" | "orderAudit", SyncResult | { error: string }>;

/** The poll, scheduler and signal use the same truth and ledgers. Each feed fails independently. */
export async function syncNotifications({ writer = crmsDatabase, reader = database, tickets = ticketsDatabase, copies = true }: {
  writer?: Connection; reader?: Connection; tickets?: Connection; copies?: boolean;
} = {}): Promise<SyncBatch> {
  const attempt = async (name: string, run: () => Promise<SyncResult>) => {
    try { return await run(); }
    catch (error) { console.error(`${name} notification sync failed`, error); return { error: "sync failed" }; }
  };
  const batch: SyncBatch = {
    cancellations: await attempt("Cancellation", () => syncCancellationRequests(reader(), writer())),
    customers: await attempt("Customer", async () => syncNewCustomers(writer(), await readCustomers(reader()))),
    tickets: await attempt("Ticket", () => syncTicketEvents(writer(), tickets())),
    feedback: await attempt("Feedback", () => syncFeedbackEvents(writer(), tickets())),
    orders: await attempt("Order", () => syncOrderEvents(writer(), tickets())),
    orderAudit: await attempt("Order audit", async () => {
      await syncOrderAudit({
        orders: () => reader()`select id, created_at from public.orders`,
        outcomes: () => reader()`select e.order_id, e.kind, to_jsonb(e)->>'occurrence' as occurrence, e.status, e.reason, e.updated_at from public.order_email_outcomes e`,
        delivered: async (ids) => new Set((await writer()<{ operation_id: string }[]>`
          select operation_id from crms.seen_order_audit_events where operation_id = any(${ids}::text[])`).map((r) => r.operation_id)),
        markDelivered: async (id) => { await writer()`insert into crms.seen_order_audit_events (operation_id) values (${id}) on conflict do nothing`; },
        deliver: deliverGatewayAuditEvent,
      });
      // Audit deliveries are not Staff notifications, so they never count as created.
      return { baselined: false, created: 0 };
    }),
    returns: await attempt("Return", async () => {
      const result = await syncReturnEvents(writer(), reader());
      await fingerprintNewReturnPhotos(writer(), reader());

      return result;
    }),
  };
  if (copies) await syncNotificationCopies(writer);
  return batch;
}

/** Copy failures never roll back the shared feed or stop another event sync. */
export async function syncNotificationCopies(writer: Connection = crmsDatabase): Promise<void> {
  try {
    const appUrl = process.env.CREOMS_APP_URL;
    if (!appUrl) throw new Error("CREOMS_APP_URL is not set");
    await syncPortalCopies(writer(), portalGateway(), appUrl);
  } catch (error) { console.error("Portal copies sync failed", error); }
}
export const createdNotifications = (batch: SyncBatch) => Object.values(batch).reduce((count, result) => count + ("created" in result ? result.created : 0), 0);
