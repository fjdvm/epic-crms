"use server";

import { revalidatePath } from "next/cache";
import { database } from "@/lib/db";
import { requireModule } from "@/lib/portal/staff";
import { FULFILMENT_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { changeFailedDelivery as changeStorefrontFailedDelivery, type FailedDeliveryUpdate, type FailedDeliveryResult } from "@/lib/storefront";
import { approvals } from "@/features/approvals/server";
import { auditFulfilment, auditFulfilmentDenied } from "./fulfilment-audit";
import type { ApprovalOptions, ApprovalResult } from "@/features/approvals/workflow";

const FAILED_DELIVERY_DONE = { record: "recorded a failed delivery on", rebook: "rebooked a failed delivery on", restock: "restocked the goods of a failed delivery on", "write-off": "wrote off the goods of a failed delivery on" } as const;

/** All failed-delivery decisions cross the same authenticated Staff action boundary. */
const FAILED_DELIVERY_EVENTS = { record: "failed_delivery.recorded", rebook: "failed_delivery.rebooked", restock: "failed_delivery.restocked", "write-off": "failed_delivery.written_off" } as const;
const FAILED_DELIVERY_WORDS = { record: "record a failed delivery on", rebook: "rebook a failed delivery on", restock: "restock a failed delivery on", "write-off": "write off a failed delivery on" } as const;

/** All failed-delivery decisions cross the same authenticated Staff action boundary. Each saved change or refusal is an Audit Event (#746). */
export async function changeFailedDelivery(id: number, update: FailedDeliveryUpdate, options: ApprovalOptions = {}): Promise<FailedDeliveryResult | ApprovalResult> {
  const staff = await requireModule(FULFILMENT_MODULE);
  const kind = update && update.action in FAILED_DELIVERY_EVENTS ? update.action : null;
  const attemptId = update && typeof update.attemptId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(update.attemptId) ? update.attemptId : null;
  const refused = async <T extends { ok: false; reason: string }>(refusal: T): Promise<T> => {
    // A request waiting for a Manager is the approval workflow's own event, not a refusal.
    if (Number.isSafeInteger(id) && id >= 1 && !(refusal as ApprovalResult).approvalId) {
      await auditFulfilmentDenied(id, staff, kind ? FAILED_DELIVERY_EVENTS[kind] : "failed_delivery.recorded", kind ? FAILED_DELIVERY_WORDS[kind] : "change a failed delivery on",
        refusal.reason, attemptId ? { attempt_id: attemptId } : {});
    }
    return refusal;
  };
  if (!canWork(staff)) return refused({ ok: false, reason: READ_ONLY_REASON });
  if (!Number.isSafeInteger(id) || id < 1 || !kind || !attemptId) return { ok: false, reason: "Invalid failed delivery." };
  try {
    const [order] = await database()`select status, fulfillment_method from public.orders where id = ${id}`;
    if (!order || order.status !== "dispatched" || order.fulfillment_method !== "delivery") return refused({ ok: false, reason: "Only a dispatched Delivery Order can have a failed delivery." });
    const execute = () => changeStorefrontFailedDelivery(id, update, staff);
    let result: FailedDeliveryResult | ApprovalResult;
    if (update.action === "write-off") {
      const [attempt] = await database()`select id from public.failed_deliveries where id = ${update.attemptId} and order_id = ${id} and rebooked_at is null and (disposition is null or disposition = 'write-off')`;
      if (!attempt) return refused({ ok: false, reason: "Failed attempt was not found or already changed." });
      const [amount] = await database()`select coalesce(sum(quantity::bigint * price_in_centavos), 0)::text as value from public.order_lines where order_id = ${id}`;
      result = await approvals().run(staff, { module: FULFILMENT_MODULE, action: "write-off", targetId: String(id), payload: { attemptId: update.attemptId, source: "failed-delivery" }, amountInCentavos: Number(amount.value) }, options, execute);
    } else result = await execute();
    if (result.ok) {
      // Stock and money decisions keep a pending audit record; the attempt id makes a replay one event.
      await auditFulfilment(id, staff, FAILED_DELIVERY_EVENTS[kind], `${staff.name} ${FAILED_DELIVERY_DONE[kind]} Order #${id}.`,
        { attempt_id: attemptId, ...(update.action === "record" ? { next_step: update.nextStep } : {}) }, attemptId, kind === "restock" || kind === "write-off");
      revalidatePath(`/orders/${id}`);
      revalidatePath("/fulfilment");
      revalidatePath("/orders");
      return result;
    }
    return refused(result);
  } catch { return refused({ ok: false, reason: "Failed delivery is temporarily unavailable. Refresh the Order before retrying." }); }
}

/** Order-scoped history is retained after rebooking; COD rules can use earlier customer attempts. */
export async function loadFailedDeliveryHistory(id: number) {
  await requireModule(FULFILMENT_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false as const, reason: "Invalid Order number." };
  try {
    const history = await database()`select f.* from public.failed_deliveries f join public.orders o on o.id = f.order_id
      where o.customer_id = (select customer_id from public.orders where id = ${id}) order by f.created_at, f.id`;
    return { ok: true as const, history };
  } catch { return { ok: false as const, reason: "Failed delivery history is temporarily unavailable." }; }
}
