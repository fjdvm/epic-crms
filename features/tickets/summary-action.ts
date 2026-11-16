"use server";

import { crmsDatabase } from "@/lib/crms-db";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";
import { openTicketSummary } from "./summary";
import type { SummaryResult } from "./summary-view";

/** Runs from the mounted Ticket, so route prefetches never generate a summary. */
export async function loadTicketSummary(ticketId: number): Promise<SummaryResult> {
  const staff = await requireModule(TICKETS_MODULE);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1 || ticketId > 999_999_999)
    return { summary: null, unavailable: true };
  try {
    return await openTicketSummary({ tickets: ticketsDatabase(), crms: crmsDatabase() }, staff, ticketId);
  } catch {
    return { summary: null, unavailable: true };
  }
}
