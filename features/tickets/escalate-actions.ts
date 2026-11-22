"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { portalGateway } from "@/features/notifications/portal-gateway";
import { nudgeStaff } from "@/features/notifications/staff-live";
import { syncNotificationCopies } from "@/features/notifications/sync";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REFUSAL, shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { ticketsWriterDatabase } from "@/lib/tickets-db";

import { escalateTicket, sendBackEscalation, takeEscalation, type ManagerRecipient } from "./escalate";
import type { EscalateFailure, EscalationReason } from "./escalate-reasons";

export type EscalateOutcome = { ok: true } | { ok: false; reason: EscalateFailure | "read-only" };

/** Every Manager the Portal says holds the Tickets Module, by Ticket username. */
async function managers(): Promise<ManagerRecipient[]> {
  const staff = await portalGateway().recipients();

  return staff.flatMap((p) =>
    p.username && p.name?.trim() && p.modules.includes(TICKETS_MODULE) && shopRole(p.role ?? "") === "manager"
      ? [{ username: p.username, name: p.name }]
      : [],
  );
}

function deps() {
  return { tickets: ticketsWriterDatabase(), crms: crmsDatabase(), audit: gatewayAuditTrail };
}

/** Run one escalation action as a Staff member who holds the Tickets Module, then refresh what it touches. */
async function act(ticketId: number, run: (staff: Awaited<ReturnType<typeof requireModule>>) => Promise<EscalateOutcome>): Promise<EscalateOutcome> {
  const staff = await requireModule(TICKETS_MODULE);
  if (!canWork(staff)) return READ_ONLY_REFUSAL as EscalateOutcome;

  try {
    const result = await run(staff);

    if (result.ok) {
      revalidatePath("/tickets");
      revalidatePath(`/tickets/${ticketId}`);
      // Best effort: the alerts are already saved; these only make them appear sooner.
      after(async () => {
        await syncNotificationCopies().catch(() => {});
        await nudgeStaff().catch(() => {});
      });
    }

    return result;
  } catch (error) {
    console.error("Escalation could not be saved", error);

    return { ok: false, reason: "unavailable" };
  }
}

/** The Claimer asks every Manager for help. */
export async function escalate(ticketId: number, reason: EscalationReason, note: string, operationId?: string): Promise<EscalateOutcome> {
  return act(Number(ticketId), async (staff) =>
    escalateTicket(deps(), staff, Number(ticketId), { reason, note: String(note ?? "") }, await managers(), operationId || randomUUID()),
  );
}

/** A Manager takes the Ticket and becomes its Claimer. */
export async function takeEscalated(ticketId: number, operationId?: string): Promise<EscalateOutcome> {
  return act(Number(ticketId), (staff) => takeEscalation(deps(), staff, Number(ticketId), operationId || randomUUID()));
}

/** A Manager sends the Ticket back to its Claimer with a note. */
export async function sendBack(ticketId: number, note: string, operationId?: string): Promise<EscalateOutcome> {
  return act(Number(ticketId), (staff) => sendBackEscalation(deps(), staff, Number(ticketId), String(note ?? ""), operationId || randomUUID()));
}

