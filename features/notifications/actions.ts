"use server";

import { syncNotifications } from "./sync";
import { staffLiveUrl } from "./staff-live";

import { revalidatePath } from "next/cache";

import { crmsDatabase } from "@/lib/crms-db";
import { getShell } from "@/lib/portal/staff";

import { loadNotifications, viewerFor } from "./load";
import { markAllRead, markRead, DEFAULT_SCHEMA, type NotificationFeed } from "./notifications";

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
 * What the browser polls: looks for newly verified Customers and new Ticket, Order and Return events and low-rating Feedback, then returns
 * the latest feed. A failed sync is logged and the feed is still returned, so the bell keeps working.
 */
export async function pollNotifications(): Promise<NotificationFeed | null> {
  const viewer = await currentViewer();
  if (!viewer) return null;

  await syncNotifications();

  return loadNotifications(crmsDatabase, viewer);
}

/** A shared content-free channel: only authenticated Staff may obtain its short-lived pass. */
export async function staffNotificationsLiveUrl(): Promise<string | null> {
  await getShell();
  try { return await staffLiveUrl(); }
  catch (error) { console.error("Staff live connection unavailable", error); return null; }
}
