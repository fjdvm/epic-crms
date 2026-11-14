import { createHmac, timingSafeEqual } from "node:crypto";
import type { FakeFileStorage } from "./fake-file-storage";
import type postgres from "postgres";

export const FAKE_STOREFRONT_URL = "https://storefront.test";
export const FAKE_SERVICE_SECRET = "fake-creoms-service-key-for-tests-only";

/** The storefront Order status contract, backed by the test database shared with CREOMS reads. */
export class FakeStorefront {
  refusal: string | null = null;
  unavailable = false;
  requests = 0;
  /** Courier bookings the fake storefront has recorded, by Order id. */
  couriers = new Map<number, Record<string, string>>();

  constructor(private sql: postgres.Sql, private now: () => Date = () => new Date(), private files?: FakeFileStorage) {}

  private async requestReturn(request: Request, orderId: number): Promise<Response> {
    const customerId = request.headers.get("X-Test-Customer");
    if (!customerId) return Response.json({ error: "Sign in first." }, { status: 401 });
    const body = await request.json();
    if (!Array.isArray(body.lineIds) || body.lineIds.length === 0 ||
      body.lineIds.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1) ||
      new Set(body.lineIds).size !== body.lineIds.length ||
      !["damaged", "defective", "wrong item", "other"].includes(body.reason) ||
      typeof body.note !== "string" || !Array.isArray(body.imageFileIds) ||
      body.imageFileIds.length < 1 || body.imageFileIds.length > 3 ||
      body.imageFileIds.some((id: unknown) => typeof id !== "string" || !id.trim()) ||
      (body.preferredResolution !== undefined && !["refund", "replacement"].includes(body.preferredResolution)) ||
      (body.videoFileId !== undefined && (typeof body.videoFileId !== "string" || !body.videoFileId.trim()))) {
      return Response.json({ error: "Invalid Return request." }, { status: 400 });
    }
    return this.sql.begin(async tx => {
      const [order] = await tx`select o.*, c.full_name from orders o join customers c on c.id = o.customer_id
        where o.id = ${orderId} and o.customer_id = ${customerId} for update of o`;
      if (!order) return Response.json({ error: "Order was not found." }, { status: 404 });
      const now = this.now();
      const deliveredAt = order.delivered_at as Date | null;
      if (order.status !== "delivered" || !deliveredAt || now < deliveredAt ||
        now.getTime() >= deliveredAt.getTime() + 24 * 60 * 60 * 1000) {
        return Response.json({ error: "The 24-hour Refund window is closed." }, { status: 409 });
      }
      const lines = await tx`select * from order_lines where order_id = ${orderId} and id in ${tx(body.lineIds)}`;
      if (lines.length !== body.lineIds.length) return Response.json({ error: "Choose this Order's whole line items." }, { status: 400 });
      const [overlap] = await tx`select 1 from order_return_items i join order_returns r on r.id = i.return_id
        where r.order_id = ${orderId} and r.status not in ('declined','cancelled') and i.order_line_id in ${tx(body.lineIds)} limit 1`;
      if (overlap) return Response.json({ error: "Those items already have a Return." }, { status: 409 });
      const [total] = await tx`select count(*)::int as count from order_lines where order_id = ${orderId}`;
      const amount = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.price_in_centavos), 0) +
        (lines.length === total.count ? Number(order.delivery_fee_in_centavos ?? 0) : 0);
      const [created] = await tx`insert into order_returns (order_id, reason, note, amount_in_centavos, requested_at, preferred_resolution, video_file_id)
        values (${orderId}, ${body.reason}, ${body.note}, ${amount}, ${now}, ${body.preferredResolution ?? "refund"}, ${body.videoFileId ?? null}) returning id`;
      for (const line of lines) {
        await tx`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos)
          values (${created.id}, ${line.id}, ${line.product_name}, ${line.size_label}, ${line.quantity}, ${line.price_in_centavos})`;
      }
      for (const [index, fileId] of body.imageFileIds.entries()) {
        await tx`insert into order_return_images (return_id, position, file_id) values (${created.id}, ${index + 1}, ${fileId})`;
      }
      await tx`insert into order_return_history (return_id, status, actor_type, actor_id, actor_name, occurred_at)
        values (${created.id}, 'requested', 'customer', ${customerId}, ${order.full_name}, ${now})`;
      return Response.json({ id: created.id }, { status: 201 });
    });
  }

  private async decideReturn(request: Request, id: number): Promise<Response> {
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const update = await request.json();
    if (typeof update.staffId !== "string" || !update.staffId.trim() ||
      typeof update.staffName !== "string" || !update.staffName.trim()) {
      return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    }
    if (update.status === "approved" && typeof update.goodsRequired !== "boolean") {
      return Response.json({ error: "Say whether the goods must come back." }, { status: 400 });
    }
    if (update.status === "approved" && update.finalResolution !== undefined &&
      !["refund", "replacement"].includes(update.finalResolution)) {
      return Response.json({ error: "Invalid Resolution." }, { status: 400 });
    }
    if (update.status === "refunded" && (typeof update.refundProofFileId !== "string" || !update.refundProofFileId.trim())) {
      return Response.json({ error: "Refund proof is required." }, { status: 400 });
    }
    if (update.status === "declined" && (typeof update.declineReason !== "string" || !update.declineReason.trim())) {
      return Response.json({ error: "Enter a reason for declining the Return." }, { status: 400 });
    }
    if (update.status === "refunded") {
      // #232 contract: linked Active Private proof may still be Temporary until confirmation.
      // The storefront companion validator accepts unexpired Temporary proof before CREOMS promotes it.
      const file = this.files?.files.get(update.refundProofFileId);
      if (!file || file.returnId !== id || file.visibility !== "private" || file.status !== "active") {
        return Response.json({ error: "Refund proof must be linked to this Return." }, { status: 400 });
      }
    }
    return this.sql.begin(async tx => {
      const [current] = await tx`select * from order_returns where id = ${id} for update`;
      if (!current) return Response.json({ error: "Return was not found." }, { status: 404 });
      const allowed = (update.status === "approved" || update.status === "declined") && current.status === "requested" ||
        update.status === "goods received" && current.status === "approved" && current.goods_required === true ||
        (update.status === "refunded" || update.status === "replaced") &&
          (current.status === "goods received" || current.status === "approved" && current.goods_required === false) &&
          current.final_resolution === (update.status === "refunded" ? "refund" : "replacement");
      if (!allowed) return Response.json({ error: "Return already changed." }, { status: 409 });
      const at = this.now();
      const [changed] = await tx`update order_returns set status = ${update.status},
        final_resolution = ${update.status === "approved" ? update.finalResolution ?? current.preferred_resolution : current.final_resolution},
        refund_proof_file_id = ${update.status === "refunded" ? update.refundProofFileId : current.refund_proof_file_id},
        replaced_at = ${update.status === "replaced" ? at : current.replaced_at},
        goods_required = ${update.status === "approved" ? update.goodsRequired : current.goods_required},
        decline_reason = ${update.status === "declined" ? update.declineReason.trim() : current.decline_reason},
        refunded_at = ${update.status === "refunded" ? at : current.refunded_at}
        where id = ${id} returning *`;
      await tx`insert into order_return_history (return_id, status, actor_type, actor_id, actor_name, occurred_at, note)
        values (${id}, ${update.status}, 'staff', ${update.staffId}, ${update.staffName}, ${at}, ${changed.decline_reason})`;
      return Response.json({ id, status: changed.status, goodsRequired: changed.goods_required,
        finalResolution: changed.final_resolution, refundProofFileId: changed.refund_proof_file_id,
        declineReason: changed.decline_reason, actedBy: { id: update.staffId, name: update.staffName, at: at.toISOString() } });
    });
  }

  handle = async (request: Request): Promise<Response> => {
    this.requests++;
    if (this.unavailable) throw new Error("Storefront unavailable");
    // Customer authentication in the fake only. Production uses the storefront's own session.
    const returnRequest = new URL(request.url).pathname.match(/^\/api\/orders\/(\d+)\/returns$/);
    if (returnRequest && request.method === "POST") return this.requestReturn(request, Number(returnRequest[1]));
    const returnDecision = new URL(request.url).pathname.match(/^\/api\/internal\/returns\/(\d+)\/status$/);
    const resource = returnDecision ? "returns" : "orders";
    const parts = request.headers.get("authorization")?.replace(/^Bearer /, "").split(".");
    if (!parts || parts.length !== 3) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const [header, payload, signature] = parts;
    const expected = createHmac("sha256", FAKE_SERVICE_SECRET).update(`${header}.${payload}`).digest("base64url");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ||
      JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "HS256" ||
      claims.iss !== "creoms" || claims.aud !== `brenraphaels-${resource}` || claims.scope !== `${resource}:status` ||
      claims.iat > now || claims.exp <= now || claims.exp - claims.iat > 900) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (returnDecision && request.method === "POST") return this.decideReturn(request, Number(returnDecision[1]));
    const cancelItems = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/items\/cancel$/);
    if (cancelItems && request.method === "POST") {
      const id = Number(cancelItems[1]);
      const { lineIds, staffId, staffName, expectedStatus } = await request.json();
      if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
      return this.sql.begin(async tx => {
        const [order] = await tx`select * from orders where id = ${id} for update`;
        if (!order || order.status !== expectedStatus || !["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(order.status) || !staffId || !staffName) {
          return Response.json({ error: "Items can no longer be cancelled on this Order." }, { status: 409 });
        }
        const lines = await tx`select * from order_lines where order_id = ${id}`;
        const remaining = lines.filter(line => !lineIds.includes(line.id));
        if (!remaining.length || lines.length - remaining.length !== lineIds.length) return Response.json({ error: "Those items already changed. Refresh the Order." }, { status: 409 });
        const subtotal = remaining.reduce((sum, line) => sum + line.quantity * line.price_in_centavos, 0);
        const needsQuote = order.fulfillment_method === "delivery" && order.subtotal_in_centavos > 250000 && subtotal <= 250000;
        await tx`delete from order_lines where order_id = ${id} and id in ${tx(lineIds)}`;
        const [updated] = await tx`update orders set subtotal_in_centavos = ${subtotal},
          status = ${order.status}, delivery_fee_in_centavos = ${needsQuote ? null : order.delivery_fee_in_centavos}
          where id = ${id} returning *`;
        return Response.json({ id, status: updated.status, deliveryFeeInCentavos: updated.delivery_fee_in_centavos });
      });
    }
    const match = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/status$/);
    if (!match || request.method !== "POST") return new Response(null, { status: 404 });
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const id = Number(match[1]);
    const update = await request.json();
    const [order] = await this.sql`select * from orders where id = ${id}`;
    if (!order) return Response.json({ error: "Order was not found." }, { status: 404 });
    const mayConfirm = update.status === "confirmed" && (order.status === "placed" || order.fulfillment_method === "delivery" && order.delivery_fee_in_centavos === null && ["confirmed", "awaiting payment", "paid", "preparing"].includes(order.status));
    const mayCancel = update.status === "cancelled" &&
      ["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(order.status);
    const mayPrepare = update.status === "preparing" && (order.status === "paid" ||
      (order.status === "confirmed" && order.payment_method === "cash-on-delivery"));
    const mayDispatch = update.status === "dispatched" && order.status === "preparing";
    const mayDeliver = update.status === "delivered" && order.status === "dispatched";
    const mayMarkPaid = update.status === "paid" && order.status === "awaiting payment";
    if (mayDeliver && (!update.deliveryPhotoFileId || order.delivery_photo_file_id)) {
      return Response.json({ error: "Exactly one permanent Delivery photo is required." }, { status: 400 });
    }
    if (mayDispatch && order.fulfillment_method === "delivery" &&
      (!["Lalamove", "Grab"].includes(update.courier?.name) || !/^https:\/\//.test(update.courier?.trackingUrl ?? ""))) {
      return Response.json({ error: "Dispatching a Delivery Order needs the courier and an https tracking link." }, { status: 400 });
    }
    if (mayMarkPaid && (!update.staffId || !update.staffName)) {
      return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    }
    if (!mayConfirm && !mayCancel && !mayPrepare && !mayDispatch && !mayDeliver && !mayMarkPaid) return Response.json({ error: "Order already changed." }, { status: 409 });
    if (mayConfirm && order.fulfillment_method === "delivery" &&
      (!Number.isSafeInteger(update.deliveryFeeInCentavos) || update.deliveryFeeInCentavos < 0)) {
      return Response.json({ error: "A Delivery fee is required." }, { status: 400 });
    }
    const [changed] = await this.sql`
      update orders set status = ${mayConfirm && order.status !== "placed" ? order.status : update.status},
        delivery_photo_file_id = ${mayDeliver ? update.deliveryPhotoFileId : order.delivery_photo_file_id},
        delivered_at = ${mayDeliver ? new Date() : order.delivered_at},
        delivery_fee_in_centavos = ${update.deliveryFeeInCentavos ?? order.delivery_fee_in_centavos},
        paid_by_id = ${mayMarkPaid ? update.staffId : order.paid_by_id},
        paid_by_name = ${mayMarkPaid ? update.staffName : order.paid_by_name},
        paid_at = ${mayMarkPaid ? new Date() : order.paid_at}
      where id = ${id} and status = ${order.status} returning id, status, delivery_fee_in_centavos, delivery_photo_file_id`;
    if (!changed) return Response.json({ error: "Order already changed." }, { status: 409 });
    if (mayDispatch && update.courier) this.couriers.set(id, update.courier);
    return Response.json({ id: changed.id, status: changed.status, ...(this.couriers.has(id) ? { courier: this.couriers.get(id) } : {}), deliveryFeeInCentavos: changed.delivery_fee_in_centavos, deliveryPhotoFileId: changed.delivery_photo_file_id });
  };
}

export function storefrontFetch(storefront: FakeStorefront): typeof fetch {
  return (async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== FAKE_STOREFRONT_URL) throw new Error("Unexpected destination");
    return storefront.handle(request);
  }) as typeof fetch;
}
