"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { database } from "@/lib/db";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";

import { recordCustomerProfileView } from "./profile";

import type { WalkInInput } from "./walk-in-rules";
import { addWalkIn, editWalkIn, type EditWalkInResult, type AddWalkInResult } from "./walk-ins";

export type AddWalkInActionResult = AddWalkInResult | { ok: false; unavailable: true } | { ok: false; forbidden: true; message: string };

// Server actions are public endpoints, so this proves the Staff member holds the Module.
export async function addWalkInCustomer(input: WalkInInput, operationId: string = randomUUID()): Promise<AddWalkInActionResult> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);

  if (!canWork(staff)) return { ok: false, forbidden: true, message: READ_ONLY_REASON };
  try {
    const result = await addWalkIn(database(), crmsDatabase(), input, undefined, { trail: gatewayAuditTrail, staff, operationId });
    if (result.ok) revalidatePath("/customer-profiles");

    return result;
  } catch (error) {
    console.error("Walk-in Customer could not be saved", error);

    return { ok: false, unavailable: true };
  }
}

/** Backend endpoint for editing the entered details of a Walk-in Customer. */
export async function editWalkInCustomer(id: string, input: WalkInInput, operationId: string = randomUUID()): Promise<EditWalkInResult | { ok: false; unavailable: true } | { ok: false; forbidden: true; message: string }> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  if (!canWork(staff)) return { ok: false, forbidden: true, message: READ_ONLY_REASON };
  try {
    const result = await editWalkIn(database(), crmsDatabase(), id, input, undefined, { trail: gatewayAuditTrail, staff, operationId });
    if (result.ok) {
      revalidatePath("/customer-profiles");
      revalidatePath(`/customer-profiles/${id}`);
    }
    return result;
  } catch (error) {
    console.error("Walk-in Customer could not be edited", error);
    return { ok: false, unavailable: true };
  }
}

/** Called when the profile is visible, rather than when Next prefetches its page. */
export async function auditCustomerProfileView(id: string, operationId: string): Promise<void> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  if (typeof operationId !== "string" || !operationId || operationId.length > 200) return;
  await recordCustomerProfileView(database, id, { trail: gatewayAuditTrail, staff, operationId });
}
