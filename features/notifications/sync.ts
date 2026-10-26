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
import { syncReturnEvents } from "./return-events";

type Connection = () => postgres.Sql;
export type SyncBatch = Record<"customers" | "tickets" | "feedback" | "orders" | "returns", SyncResult | { error: string }>;

/** The poll, scheduler and signal use the same truth and ledgers. Each feed fails independently. */
export async function syncNotifications({ writer = crmsDatabase, reader = database, tickets = ticketsDatabase, copies = true }: {
  writer?: Connection; reader?: Connection; tickets?: Connection; copies?: boolean;
} = {}): Promise<SyncBatch> {
  const attempt = async (name: string, run: () => Promise<SyncResult>) => {
    try { return await run(); }
    catch (error) { console.error(`${name} notification sync failed`, error); return { error: "sync failed" }; }
  };
  const batch: SyncBatch = {
    customers: await attempt("Customer", async () => syncNewCustomers(writer(), await readCustomers(reader()))),
    tickets: await attempt("Ticket", () => syncTicketEvents(writer(), tickets())),
    feedback: await attempt("Feedback", () => syncFeedbackEvents(writer(), tickets())),
    orders: await attempt("Order", () => syncOrderEvents(writer(), tickets())),
    returns: await attempt("Return", () => syncReturnEvents(writer(), reader())),
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
