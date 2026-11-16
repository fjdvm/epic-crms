"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { nudgeStaff } from "@/features/notifications/staff-live";
import { portalGateway } from "@/features/notifications/portal-gateway";
import { syncNotificationCopies } from "@/features/notifications/sync";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase, ticketsWriterDatabase } from "@/lib/tickets-db";

import {
  claimerWorkload,
  reassignTickets,
  ticketsHeldBy,
  type AbsentTicket,
  type ReassignFailure,
  type ReassignResult,
  type Teammate,
} from "./reassign";

export type ReassignOutcome = ReassignResult | { ok: false; reason: "unavailable" };

export interface TeammateChoice extends Teammate {
  /** Open Tickets they hold now. */
  open: number;
}

export type OptionsOutcome =
  | { ok: true; teammates: TeammateChoice[] }
  | { ok: false; reason: "forbidden" | "unavailable" };

async function manager() {
  const staff = await requireModule(TICKETS_MODULE);

  return shopRole(staff.role) === "manager" ? staff : null;
}

/** Staff the Portal says can work Tickets, by Ticket username, so a Ticket always names a real person. */
async function directory(): Promise<Teammate[]> {
  const staff = await portalGateway().recipients();

  return staff.flatMap((p) => {
    const role = shopRole(p.role ?? "");
    if (!p.username || !p.name?.trim() || !p.modules.includes("Tickets") || (role !== "staff" && role !== "manager")) return [];

    return [{ id: p.username, name: p.name, role }];
  });
}

/** Who a Manager can move Tickets to, with each person's workload. Opened on demand, never on a timer. */
export async function reassignOptions(): Promise<OptionsOutcome> {
  if (!(await manager())) return { ok: false, reason: "forbidden" };

  try {
    const [people, load] = await Promise.all([directory(), claimerWorkload(ticketsDatabase())]);

    return { ok: true, teammates: people.map((p) => ({ ...p, open: load.get(p.id) ?? 0 })) };
  } catch (error) {
    console.error("Reassign choices could not be read", error);

    return { ok: false, reason: "unavailable" };
  }
}

/** The Tickets a bulk move would take from one teammate. */
export async function absentTickets(claimerId: string): Promise<{ ok: true; tickets: AbsentTicket[] } | { ok: false; reason: "forbidden" | "unavailable" }> {
  if (!(await manager())) return { ok: false, reason: "forbidden" };

  try {
    return { ok: true, tickets: await ticketsHeldBy(ticketsDatabase(), String(claimerId)) };
  } catch (error) {
    console.error("The teammate's Tickets could not be read", error);

    return { ok: false, reason: "unavailable" };
  }
}

async function move(
  ticketIds: number[],
  fromId: string,
  toId: string,
  reason: string,
  operationId: string,
  bulk: boolean,
): Promise<ReassignOutcome> {
  const staff = await manager();
  if (!staff) return { ok: false, reason: "forbidden" };

  try {
    const to = (await directory()).find((p) => p.id === String(toId));
    if (!to) return { ok: false, reason: "invalid-recipient" as ReassignFailure };

    let customer: { id: string; name: string } | null = null;
    if (!bulk && ticketIds.length === 1) {
      const [row] = await ticketsDatabase()<{ id: string; full_name: string }[]>`
        select c.id, c.full_name from tickets t join customers c on c.id = t.customer_id where t.id = ${ticketIds[0]}`;
      customer = row ? { id: row.id, name: row.full_name } : null;
    }

    const result = await reassignTickets(
      { tickets: ticketsWriterDatabase(), crms: crmsDatabase(), audit: gatewayAuditTrail },
      staff,
      { ticketIds, fromId: String(fromId), to, reason, operationId: operationId || randomUUID(), bulk, customer },
    );

    if (result.ok) {
      revalidatePath("/tickets");
      for (const id of result.moved) revalidatePath(`/tickets/${id}`);
      // Best effort: the alerts are already saved; these only make them appear sooner.
      after(async () => {
        await syncNotificationCopies().catch(() => {});
        await nudgeStaff().catch(() => {});
      });
    }

    return result;
  } catch (error) {
    console.error("Tickets could not be reassigned", error);

    return { ok: false, reason: "unavailable" };
  }
}

export async function reassignOne(ticketId: number, fromId: string, toId: string, reason: string, operationId: string) {
  return move([Number(ticketId)], fromId, toId, reason, operationId, false);
}

/** `ticketIds` are the Tickets the Manager saw; any no longer held by `fromId` are skipped and counted. */
export async function reassignAll(ticketIds: number[], fromId: string, toId: string, reason: string, operationId: string) {
  return move(Array.isArray(ticketIds) ? ticketIds.map(Number) : [], fromId, toId, reason, operationId, true);
}
