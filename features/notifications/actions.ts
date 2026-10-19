"use server";

import { revalidatePath } from "next/cache";

import { crmsDatabase } from "@/lib/crms-db";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import { markAllRead, markRead } from "./notifications";

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
