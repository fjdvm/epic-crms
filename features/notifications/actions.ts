"use server";

import { revalidatePath } from "next/cache";

import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import { loadNotifications } from "./load";
import { markAllRead, markRead, readCustomers, syncNewCustomers, type NotificationFeed } from "./notifications";

// Server actions are public endpoints, so each one proves the Staff member holds the Module.
export async function markNotificationRead(id: string) {
  await requireModule(CUSTOMER_PROFILES_MODULE);
  await markRead(crmsDatabase(), id);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  await requireModule(CUSTOMER_PROFILES_MODULE);
  await markAllRead(crmsDatabase());
  revalidatePath("/", "layout");
}

/**
 * What the browser polls: looks for newly verified Customers, then returns the latest feed.
 * A failed sync is logged and the feed is still returned, so the bell keeps working.
 */
export async function pollNotifications(): Promise<NotificationFeed | null> {
  await requireModule(CUSTOMER_PROFILES_MODULE);

  try {
    await syncNewCustomers(crmsDatabase(), await readCustomers(database()));
  } catch (error) {
    console.error("New Customer sync failed", error);
  }

  return loadNotifications(crmsDatabase);
}
