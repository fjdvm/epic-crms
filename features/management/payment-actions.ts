"use server";

import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { recordUpload } from "@/features/files/server";
import { directFileStorage } from "@/features/files/storage";
import { requireModule } from "@/lib/portal/staff";

import type { PaymentAccountInput } from "./payment-account-format";
import { addPaymentAccount, setPaymentAccountQr } from "./payment-accounts";

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

/** The upload itself went straight to File Storage; this only attaches the confirmed image, or removes it with a null reference. */
export async function changePaymentAccountQr(accountId: string, reference: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  const staff = await requireModule(MANAGEMENT_MODULE);
  try {
    return await setPaymentAccountQr(crmsDatabase(), gatewayAuditTrail, {
      claim: async (ref, staffId) => { const u = await recordUpload(MANAGEMENT_MODULE, ref, staffId); return u ? { fileId: u.fileId, filename: u.filename } : null; },
      remove: (fileId) => directFileStorage.remove(fileId),
    }, staff, accountId, reference);
  } catch (error) {
    console.error("Payment account QR could not be saved", error);
    return { ok: false, reason: "CREOMS could not save the QR image. Try again in a moment." };
  }
}
