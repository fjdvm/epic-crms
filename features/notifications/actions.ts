"use server";

import { revalidatePath } from "next/cache";

import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { getShell } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

import { loadNotifications, viewerFor } from "./load";
import { markAllRead, markRead, readCustomers, syncNewCustomers, DEFAULT_SCHEMA, type NotificationFeed } from "./notifications";
import { syncTicketEvents } from "./ticket-events";

/** Server actions are public endpoints, so each one works out what this Staff member may see. */
async function currentViewer() {
  const { staff, permittedPages } = await getShell();

  return viewerFor(staff, permittedPages);
}

export async function markNotificationRead(id: string) {
  const viewer = await currentViewer();
  if (!viewer) return;

  await markRead(crmsDatabase(), id, DEFAULT_SCHEMA, viewer);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const viewer = await currentViewer();
  if (!viewer) return;

  await markAllRead(crmsDatabase(), DEFAULT_SCHEMA, viewer);
  revalidatePath("/", "layout");
}

/**
 * What the browser polls: looks for newly verified Customers and new Ticket events, then returns
 * the latest feed. A failed sync is logged and the feed is still returned, so the bell keeps working.
 */
export async function pollNotifications(): Promise<NotificationFeed | null> {
  const viewer = await currentViewer();
  if (!viewer) return null;

  try {
    await syncNewCustomers(crmsDatabase(), await readCustomers(database()));
  } catch (error) {
    console.error("New Customer sync failed", error);
  }

  try {
    await syncTicketEvents(crmsDatabase(), ticketsDatabase());
  } catch (error) {
    console.error("Ticket notification sync failed", error);
  }

  return loadNotifications(crmsDatabase, viewer);
}
