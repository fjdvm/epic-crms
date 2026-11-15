import { after } from "next/server";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { portalGateway } from "@/features/notifications/portal-gateway";
import { shopRole } from "@/lib/portal/roles";
import { appUrl } from "@/lib/portal/config";
import { approvalWorkflow } from "./workflow";

export function approvals() {
  return approvalWorkflow(crmsDatabase(), gatewayAuditTrail, async ({ request, audience, text, key }) => {
    if (audience === "requester" && request.requester_id.startsWith("customer:")) return;
    const portal = portalGateway();
    const people = await portal.recipients();
    if (people.some(person => person.modules.includes(request.module) && typeof person.role !== "string")) {
      throw new Error("Portal approval recipients must include their Role");
    }
    const recipients = people.filter(person => person.modules.includes(request.module) &&
      (audience === "requester" ? person.id === request.requester_id : shopRole(person.role ?? "") === audience));
    if (!recipients.length) throw new Error("No eligible approval recipient is available");
    for (const person of recipients) {
      if (!person.modules.includes(request.module)) continue;
      if (audience === "requester" ? person.id !== request.requester_id : shopRole(person.role ?? "") !== audience) continue;
      await portal.send({ key: `${key}:${person.id}`, userId: person.id, text, link: `${appUrl()}/${request.module === "Fulfilment" ? "fulfilment" : request.action.startsWith("order.") ? "fulfilment" : request.action.startsWith("payment.") ? "payments" : "returns"}` });
    }
  }, after);
}
