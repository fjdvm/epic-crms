"use server";

import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import { changeFreeDeliveryThreshold } from "./free-delivery-threshold";

/** Re-checks the Module on the server; the Role is checked again inside the change itself. */
export async function setFreeDeliveryThreshold(input: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const staff = await requireModule(MANAGEMENT_MODULE);
  try {
    const result = await changeFreeDeliveryThreshold(crmsDatabase(), gatewayAuditTrail, staff, input);
    return result.ok ? { ok: true } : result;
  } catch (error) {
    console.error("Free delivery threshold could not be saved", error);
    return { ok: false, reason: "CREOMS could not save the threshold. Try again in a moment." };
  }
}
