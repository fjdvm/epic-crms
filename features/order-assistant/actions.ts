"use server";
import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/portal/staff";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { ticketsDatabase } from "@/lib/tickets-db";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { flagAnswer } from "./flag";
export async function markWrong(
  ticketId: number,
  messageId: number,
  reason: string,
) {
  const staff = await requireModule(TICKETS_MODULE);
  try {
    const result = await flagAnswer(
      {
        tickets: ticketsDatabase(),
        crms: crmsDatabase(),
        audit: gatewayAuditTrail,
      },
      staff,
      ticketId,
      messageId,
      reason,
    );
    if (result.ok) revalidatePath("/tickets", "layout");
    return result;
  } catch {
    return {
      ok: false,
      reason: "The answer could not be marked wrong. Please try again.",
    };
  }
}
