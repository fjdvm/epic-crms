import { feedbackAnchor } from "@/features/feedback/anchor";
import { returnAnchor } from "@/features/returns/anchor";

import type { Notification } from "./notifications";

/** What a notification says and where it leads; the bell and the toast read it the same way. */
export function describeNotification(n: Notification): { text: string; href: string } {
  const ticket = `TKT-${n.ticketId}`;
  const href = `/tickets/${n.ticketId}`;

  const stars = `${n.rating} ${n.rating === 1 ? "star" : "stars"}`;

  switch (n.kind) {
    case "new-customer":
      return { text: `${n.customerName} became a Customer`, href: `/customer-profiles/${encodeURIComponent(n.customerId)}` };
    case "ticket-new":
      return { text: `${n.customerName} raised ${ticket}`, href };
    case "ticket-message":
      return { text: `${n.customerName} sent a message on ${ticket}`, href };
    case "feedback-low":
      return { text: `${n.customerName} rated Order #${n.orderId} ${stars}`, href: `/feedback#${feedbackAnchor(n.orderId!)}` };
    case "order-delivery-fee":
      return { text: `${n.customerName} placed Order #${n.orderId}, which needs a Delivery fee`, href: `/orders/${n.orderId}` };
    case "order-payment-proof":
      return { text: `${n.customerName} submitted Payment proof for Order #${n.orderId}`, href: `/orders/${n.orderId}` };
    case "return-requested":
      return { text: `${n.customerName} requested Return RMA-${n.returnId}`, href: `/returns#${returnAnchor(n.returnId!)}` };
    case "ticket-not-fixed":
      return { text: `${n.customerName} says ${ticket} is not fixed`, href };
  }
}
