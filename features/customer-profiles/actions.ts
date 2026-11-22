"use server";

import { gatewayAuditTrail } from "@/lib/gateway";
import { database } from "@/lib/db";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import { recordCustomerProfileView } from "./profile";

/** Called when the profile is visible, rather than when Next prefetches its page. */
export async function auditCustomerProfileView(id: string, operationId: string): Promise<void> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  if (typeof operationId !== "string" || !operationId || operationId.length > 200) return;
  await recordCustomerProfileView(database, id, { trail: gatewayAuditTrail, staff, operationId });
}
