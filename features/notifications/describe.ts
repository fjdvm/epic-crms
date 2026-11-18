import { feedbackAnchor } from "@/features/feedback/anchor";
import { returnAnchor } from "@/features/returns/anchor";

import { escalationReasonLabel } from "@/features/tickets/escalate-reasons";

import type { EscalationDetail, Notification, ReassignDetail, SentBackDetail } from "./notifications";

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
    case "order-free-delivery":
      return { text: `${n.customerName} placed Order #${n.orderId} · Free delivery, confirmed. No quote is needed`, href: `/orders/${n.orderId}` };
    case "order-placed":
      return { text: `${n.customerName} placed Order #${n.orderId}`, href: `/orders/${n.orderId}` };
    case "order-delivery-fee":
      return { text: `${n.customerName} placed Order #${n.orderId}, which needs a Delivery fee`, href: `/orders/${n.orderId}` };
    case "order-payment-proof":
      return { text: `${n.customerName} submitted Payment proof for Order #${n.orderId}`, href: `/orders/${n.orderId}` };
    case "order-overdue":
      return { text: `Order #${n.orderId} from ${n.customerName} is Overdue to confirm`, href: `/orders/${n.orderId}` };
    case "payment-review":
      return { text: `Order #${n.orderId} from ${n.customerName} needs a Manager payment review after 3 rejected proofs`, href: `/orders/${n.orderId}` };
    case "payment-review-overdue":
      return { text: `The payment review for Order #${n.orderId} from ${n.customerName} is Overdue. Nothing is cancelled; a Manager must decide`, href: `/orders/${n.orderId}` };
    case "return-requested":
      return { text: `${n.customerName} requested Return RMA-${n.returnId}`, href: `/returns#${returnAnchor(n.returnId!)}` };
    case "ticket-reassigned": {
      const d = n.detail as ReassignDetail | null | undefined;
      if (!d) return { text: `${ticket} was reassigned`, href };
      const what = d.count > 1 ? `${d.count} Tickets` : ticket;
      const where = d.count > 1 ? "/tickets" : href;
      return {
        text: d.side === "new"
          ? `${d.by} moved ${what} from ${d.from} to you. Reason: ${d.reason}`
          : `${d.by} moved ${what} from you to ${d.to}. Reason: ${d.reason}`,
        href: where,
      };
    }
    case "ticket-escalated": {
      const d = n.detail as EscalationDetail | null | undefined;
      if (!d) return { text: `${ticket} was escalated to the Managers`, href };
      return { text: `${d.by} escalated ${ticket}: ${escalationReasonLabel(d.reason)}. ${d.note}`, href };
    }
    case "ticket-sent-back": {
      const d = n.detail as SentBackDetail | null | undefined;
      if (!d) return { text: `${ticket} was sent back to you by a Manager`, href };
      return { text: `${d.by} sent ${ticket} back to you. ${d.note}`, href };
    }
    case "ticket-not-fixed":
      return { text: `${n.customerName} says ${ticket} is not fixed`, href };
  }
}
