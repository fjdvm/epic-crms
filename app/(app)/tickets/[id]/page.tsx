import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TicketDetailView } from "@/features/tickets/ticket-detail";
import { loadTicket } from "@/features/tickets/ticket";
import { gatewayFileStorage } from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(TICKETS_MODULE);

  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();

  const result = await loadTicket(ticketsDatabase, Number(id), gatewayFileStorage);

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

  return <TicketDetailView ticket={result.ticket} viewerId={staff.username} />;
}
