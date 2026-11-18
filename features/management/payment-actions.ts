"use server";

import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import type { PaymentAccountInput } from "./payment-account-format";
import { addPaymentAccount } from "./payment-accounts";

/** Re-checks the Module on the server; the Role is checked again inside the add itself. */
export async function createPaymentAccount(input: PaymentAccountInput): Promise<{ ok: true } | { ok: false; reason: string }> {
  const staff = await requireModule(MANAGEMENT_MODULE);
  try {
    return await addPaymentAccount(crmsDatabase(), gatewayAuditTrail, staff, input);
  } catch (error) {
    console.error("Payment account could not be saved", error);
    return { ok: false, reason: "CREOMS could not save the Payment account. Try again in a moment." };
  }
}
