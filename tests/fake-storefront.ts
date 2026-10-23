import { createHmac, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";

export const FAKE_STOREFRONT_URL = "https://storefront.test";
export const FAKE_SERVICE_SECRET = "fake-creoms-service-key-for-tests-only";

/** The storefront Order status contract, backed by the test database shared with CREOMS reads. */
export class FakeStorefront {
  refusal: string | null = null;
  unavailable = false;
  requests = 0;

  constructor(private sql: postgres.Sql, private now: () => Date = () => new Date()) {}

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
      body.imageFileIds.some((id: unknown) => typeof id !== "string" || !id.trim())) {
      return Response.json({ error: "Invalid Return request." }, { status: 400 });
    }
    return this.sql.begin(async tx => {
      const [order] = await tx`select o.*, c.full_name from orders o join customers c on c.id = o.customer_id
        where o.id = ${orderId} and o.customer_id = ${customerId} for update of o`;
      if (!order) return Response.json({ error: "Order was not found." }, { status: 404 });
      const now = this.now();
      const deliveredAt = order.delivered_at as Date | null;
      if (!["delivered", "received"].includes(order.status) || !deliveredAt || now < deliveredAt ||
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
      const [created] = await tx`insert into order_returns (order_id, reason, note, amount_in_centavos, requested_at)
        values (${orderId}, ${body.reason}, ${body.note}, ${amount}, ${now}) returning id`;
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

  handle = async (request: Request): Promise<Response> => {
    this.requests++;
    if (this.unavailable) throw new Error("Storefront unavailable");
    // Customer authentication in the fake only. Production uses the storefront's own session.
    const returnRequest = new URL(request.url).pathname.match(/^\/api\/orders\/(\d+)\/returns$/);
    if (returnRequest && request.method === "POST") return this.requestReturn(request, Number(returnRequest[1]));
    const parts = request.headers.get("authorization")?.replace(/^Bearer /, "").split(".");
    if (!parts || parts.length !== 3) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const [header, payload, signature] = parts;
    const expected = createHmac("sha256", FAKE_SERVICE_SECRET).update(`${header}.${payload}`).digest("base64url");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ||
      JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "HS256" ||
      claims.iss !== "creoms" || claims.aud !== "brenraphaels-orders" || claims.scope !== "orders:status" ||
      claims.iat > now || claims.exp <= now || claims.exp - claims.iat > 900) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const match = new URL(request.url).pathname.match(/^\/api\/internal\/orders\/(\d+)\/status$/);
    if (!match || request.method !== "POST") return new Response(null, { status: 404 });
    if (this.refusal) return Response.json({ error: this.refusal }, { status: 409 });
    const id = Number(match[1]);
    const update = await request.json();
    const [order] = await this.sql`select * from orders where id = ${id}`;
    if (!order) return Response.json({ error: "Order was not found." }, { status: 404 });
    const mayConfirm = update.status === "confirmed" && order.status === "placed";
    const mayCancel = update.status === "cancelled" &&
      ["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(order.status);
    const mayPrepare = update.status === "preparing" && (order.status === "paid" ||
      (order.status === "confirmed" && order.payment_method === "cash-on-delivery"));
    const mayDispatch = update.status === "dispatched" && order.status === "preparing";
    const mayDeliver = update.status === "delivered" && order.status === "dispatched";
    const mayMarkPaid = update.status === "paid" && order.status === "awaiting payment";
    if (mayMarkPaid && (!update.staffId || !update.staffName)) {
      return Response.json({ error: "Staff attribution is required." }, { status: 400 });
    }
    if (!mayConfirm && !mayCancel && !mayPrepare && !mayDispatch && !mayDeliver && !mayMarkPaid) return Response.json({ error: "Order already changed." }, { status: 409 });
    if (mayConfirm && order.fulfillment_method === "delivery" &&
      (!Number.isSafeInteger(update.deliveryFeeInCentavos) || update.deliveryFeeInCentavos < 0)) {
      return Response.json({ error: "A Delivery fee is required." }, { status: 400 });
    }
    const [changed] = await this.sql`
      update orders set status = ${update.status},
        delivered_at = ${mayDeliver ? new Date() : order.delivered_at},
        delivery_fee_in_centavos = ${update.deliveryFeeInCentavos ?? order.delivery_fee_in_centavos},
        paid_by_id = ${mayMarkPaid ? update.staffId : order.paid_by_id},
        paid_by_name = ${mayMarkPaid ? update.staffName : order.paid_by_name},
        paid_at = ${mayMarkPaid ? new Date() : order.paid_at}
      where id = ${id} and status = ${order.status} returning id, status, delivery_fee_in_centavos`;
    if (!changed) return Response.json({ error: "Order already changed." }, { status: 409 });
    return Response.json({ id: changed.id, status: changed.status, deliveryFeeInCentavos: changed.delivery_fee_in_centavos });
  };
}

export function storefrontFetch(storefront: FakeStorefront): typeof fetch {
  return (async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== FAKE_STOREFRONT_URL) throw new Error("Unexpected destination");
    return storefront.handle(request);
  }) as typeof fetch;
}
