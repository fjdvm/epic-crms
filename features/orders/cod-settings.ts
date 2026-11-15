import { randomUUID } from "node:crypto";

import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { shopRole } from "@/lib/portal/roles";

/** Not a server action: callers must already have checked Portal Settings access. */
export async function changeCodAmount(staff: { id: string; name: string; role: string }, amountInCentavos: number) {
  if (shopRole(staff.role) !== "admin") return { ok: false as const, reason: "Only an Admin can change the Cash on Delivery amount." };
  if (!Number.isSafeInteger(amountInCentavos) || amountInCentavos < 0) return { ok: false as const, reason: "Enter a nonnegative whole number of centavos." };
  const sql = crmsDatabase();
  const previous = await sql.begin(async tx => {
    const [row] = await tx<{ amount: string }[]>`select first_order_amount_in_centavos::text as amount from crms.cod_settings where singleton for update`;
    await tx`update crms.cod_settings set first_order_amount_in_centavos = ${amountInCentavos}, changed_by_id = ${staff.id}, changed_by_name = ${staff.name}, changed_at = now() where singleton`;
    return Number(row.amount);
  });
  await recordAudit(gatewayAuditTrail, {
    module: "Portal Settings", action: "cod_amount.changed", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "setting", id: "cod-amount", display_name: "Cash on Delivery amount" },
    description: `${staff.name} changed the Cash on Delivery first-order amount from ₱${previous / 100} to ₱${amountInCentavos / 100}.`,
    occurred_at: new Date().toISOString(), metadata: { previous, amountInCentavos }, operationId: `cod-amount:${randomUUID()}`,
  });
  return { ok: true as const };
}
