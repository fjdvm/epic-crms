import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TicketDetailView } from "@/features/tickets/ticket-detail";
import { loadTicket, type TicketResult } from "@/features/tickets/ticket";
import { readServiceLevels } from "@/features/tickets/service-level-store";
import { crmsDatabase } from "@/lib/crms-db";
import { ticketFileStorage } from "@/features/files/server";
import { listReassignments } from "@/features/tickets/reassign";
import { shopRole } from "@/lib/portal/roles";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { canOpenOrders, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(TICKETS_MODULE);

  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();

  const levels = await readServiceLevels(crmsDatabase);
  const result: TicketResult = levels
    ? await loadTicket(ticketsDatabase, Number(id), ticketFileStorage, levels)
    : { ok: false };

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg">
        <Alert variant="destructive">
          <AlertTitle>This Ticket is temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Tickets. Reload to try again; if it keeps happening, tell
            whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!result.ticket) notFound();

  // The history is CREOMS's own; if it cannot be read the Ticket still opens without it.
  const reassignments = await listReassignments(crmsDatabase(), result.ticket.id).catch((error) => {
    console.error("Reassign history could not be read", error);

    return [];
  });

  return (
    <TicketDetailView
      ticket={result.ticket}
      viewerId={staff.username}
      viewerName={staff.name}
      canOpenOrder={await canOpenOrders()}
      canReassign={shopRole(staff.role) === "manager"}
      reassignments={reassignments}
    />
  );
}
