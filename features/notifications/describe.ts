import type { Notification } from "./notifications";

/** What a notification says and where it leads; the bell and the toast read it the same way. */
export function describeNotification(n: Notification): { text: string; href: string } {
  const ticket = `TKT-${n.ticketId}`;
  const href = `/tickets/${n.ticketId}`;

  switch (n.kind) {
    case "new-customer":
      return { text: `${n.customerName} became a Customer`, href: `/customer-profiles/${encodeURIComponent(n.customerId)}` };
    case "ticket-new":
      return { text: `${n.customerName} raised ${ticket}`, href };
    case "ticket-message":
      return { text: `${n.customerName} sent a message on ${ticket}`, href };
    case "ticket-not-fixed":
      return { text: `${n.customerName} says ${ticket} is not fixed`, href };
  }
}
