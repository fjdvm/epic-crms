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
export async function syncNotifications({ writer = crmsDatabase, reader = database, tickets = ticketsDatabase }: {
  writer?: Connection; reader?: Connection; tickets?: Connection;
} = {}): Promise<SyncBatch> {
  const attempt = async (name: string, run: () => Promise<SyncResult>) => {
    try { return await run(); }
    catch (error) { console.error(`${name} notification sync failed`, error); return { error: "sync failed" }; }
  };
  return {
    customers: await attempt("Customer", async () => syncNewCustomers(writer(), await readCustomers(reader()))),
    tickets: await attempt("Ticket", () => syncTicketEvents(writer(), tickets())),
    feedback: await attempt("Feedback", () => syncFeedbackEvents(writer(), tickets())),
    orders: await attempt("Order", () => syncOrderEvents(writer(), tickets())),
    returns: await attempt("Return", () => syncReturnEvents(writer(), reader())),
  };
}
export const createdNotifications = (batch: SyncBatch) => Object.values(batch).reduce((count, result) => count + ("created" in result ? result.created : 0), 0);
