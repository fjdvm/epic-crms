import { changeDispatchedCancellation } from "@/lib/storefront";
import { after } from "next/server";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { portalGateway } from "@/features/notifications/portal-gateway";
import { shopRole } from "@/lib/portal/roles";
import { appUrl } from "@/lib/portal/config";
import { applyProductPrice } from "@/features/orders/product-content";
import { approvalWorkflow, type ApprovalRequest } from "./workflow";

/** A Manager approved a Staff request for a shop price: the price is set under that Manager's name, then the request is done. */
async function settleProductPrice(request: ApprovalRequest) {
  const price = Number((request.payload as { price?: unknown }).price);
  const result = await applyProductPrice(crmsDatabase(), gatewayAuditTrail, { id: request.manager_id!, name: request.manager_name!, role: "CREOMS Manager" },
    { productId: Number(request.target_id), price });
  if (!result.ok) throw new Error(result.reason);
  await crmsDatabase()`update crms.approval_requests set status = 'completed', completed_at = now() where id = ${request.id} and status = 'approved'`;
  const { nudgeStorefront } = await import("@/features/management/storefront-nudge");
  await nudgeStorefront().catch((error: unknown) => console.error("The storefront could not be told about the price", error));
}

export function approvals() {
  return approvalWorkflow(crmsDatabase(), gatewayAuditTrail, async ({ request, audience, text, key }) => {
    if (audience === "requester" && request.action === "order.cancel-after-dispatch" && ["approved", "declined"].includes(request.status)) {
      const [row] = await crmsDatabase()`select decline_reason from crms.approval_requests where id = ${request.id}`;
      const result = await changeDispatchedCancellation(Number(request.target_id), { action: "decide", requestId: request.id,
        decision: request.status as "approved" | "declined", reason: row?.decline_reason ?? "Manager approved cancellation" },
        { id: request.manager_id!, name: request.manager_name! });
      if (!result.ok) throw new Error(result.reason);
    }
    if (audience === "requester" && request.action === "product.price" && request.status === "approved") await settleProductPrice(request);
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
      await portal.send({ key: `${key}:${person.id}`, userId: person.id, text, link: `${appUrl()}/${request.action === "product.price" ? "orders/stock" : request.module === "Fulfilment" ? "fulfilment" : request.action.startsWith("order.") ? "fulfilment" : request.action.startsWith("payment.") ? "payments" : "returns"}` });
    }
  }, after);
}
