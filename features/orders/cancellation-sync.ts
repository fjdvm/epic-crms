import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/audit-trail";
import { gatewayAuditTrail } from "@/lib/gateway";
import type postgres from "postgres";
import { database } from "@/lib/db";
import { crmsDatabase } from "@/lib/crms-db";
import { approvals } from "@/features/approvals/server";

/** Discover durable storefront requests on a signal/reconnect/user action, never on a timer. */
export async function syncCancellationRequests(reader: postgres.Sql = database(), writer: postgres.Sql = crmsDatabase()) {
  const requests = await reader`select c.*, u.full_name from public.order_cancellations c join public.orders o on o.id = c.order_id
    join public.customers u on u.id = o.customer_id where c.status = 'waiting-manager'`;
  let created = 0;
  for (const r of requests) {
    await writer.begin(async tx => {
      const inserted = await tx`insert into crms.approval_requests (id, module, action, target_id, payload, amount_in_centavos, limit_in_centavos, reason, requester_id, requester_name)
        values (${r.id}, 'Fulfilment', 'order.cancel-after-dispatch', ${String(r.order_id)}, ${tx.json({ requestId: r.id })}, 0,
        (select limit_in_centavos from crms.approval_settings where singleton), ${r.reason}, ${r.actor_type === "customer" ? `customer:${r.actor_id}` : r.actor_id}, ${r.actor_name})
        on conflict do nothing returning id`;
      if (!inserted.length) return;
      created++;
      await tx`insert into crms.approval_events (id, request_id, action, actor_id, actor_name, details)
        values (${randomUUID()}, ${r.id}, 'order.cancel_requested', ${r.actor_id}, ${r.actor_name}, ${tx.json({ orderId: r.order_id })})`;
      await recordAudit(gatewayAuditTrail, { action: "order.cancel_requested", module: "Fulfilment", outcome: "success",
        actor: { type: "user", id: r.actor_id, display_name: r.actor_name }, target: { type: "order", id: String(r.order_id), display_name: `Order #${r.order_id}` },
        description: `${r.actor_name} requested cancellation after dispatch.`, occurred_at: new Date().toISOString(), operationId: `order-cancellation:${r.id}:requested` });
      await tx`insert into crms.approval_notices (key, request_id, audience, text)
        values (${`approval:${r.id}:waiting-manager:manager`}, ${r.id}, 'manager', ${`${r.actor_name} requested cancellation of Order #${r.order_id}: ${r.reason}`}) on conflict do nothing`;
    });
  }
  await approvals().deliverNotices();
  return { created, baselined: false };
}
