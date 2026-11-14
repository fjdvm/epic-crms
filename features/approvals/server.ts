import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { portalGateway } from "@/features/notifications/portal-gateway";
import { shopRole } from "@/lib/portal/roles";
import { appUrl } from "@/lib/portal/config";
import { approvalWorkflow } from "./workflow";

export function approvals() {
  return approvalWorkflow(crmsDatabase(), gatewayAuditTrail, async ({ request, audience, text, key }) => {
    const portal = portalGateway();
    const people = await portal.recipients();
    for (const person of people) {
      if (!person.modules.includes(request.module)) continue;
      if (audience === "requester" ? person.id !== request.requester_id : shopRole(person.role ?? "") !== audience) continue;
      await portal.send({ key: `${key}:${person.id}`, userId: person.id, text, link: `${appUrl()}/returns` });
    }
  });
}
