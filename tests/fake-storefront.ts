import { createHmac, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";

export const FAKE_STOREFRONT_URL = "https://storefront.test";
export const FAKE_SERVICE_SECRET = "fake-creoms-service-key-for-tests-only";

/** The storefront Order status contract, backed by the test database shared with CREOMS reads. */
export class FakeStorefront {
  refusal: string | null = null;
  unavailable = false;
  requests = 0;

  constructor(private sql: postgres.Sql) {}

  handle = async (request: Request): Promise<Response> => {
    this.requests++;
    if (this.unavailable) throw new Error("Storefront unavailable");
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
    if (mayDeliver && (!update.deliveryPhotoFileId || order.delivery_photo_file_id)) {
      return Response.json({ error: "Exactly one permanent Delivery photo is required." }, { status: 400 });
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
      update orders set status = ${update.status},
        delivery_photo_file_id = ${mayDeliver ? update.deliveryPhotoFileId : order.delivery_photo_file_id},
        delivered_at = ${mayDeliver ? new Date() : order.delivered_at},
        delivery_fee_in_centavos = ${update.deliveryFeeInCentavos ?? order.delivery_fee_in_centavos},
        paid_by_id = ${mayMarkPaid ? update.staffId : order.paid_by_id},
        paid_by_name = ${mayMarkPaid ? update.staffName : order.paid_by_name},
        paid_at = ${mayMarkPaid ? new Date() : order.paid_at}
      where id = ${id} and status = ${order.status} returning id, status, delivery_fee_in_centavos, delivery_photo_file_id`;
    if (!changed) return Response.json({ error: "Order already changed." }, { status: 409 });
    return Response.json({ id: changed.id, status: changed.status, deliveryFeeInCentavos: changed.delivery_fee_in_centavos, deliveryPhotoFileId: changed.delivery_photo_file_id });
  };
}

export function storefrontFetch(storefront: FakeStorefront): typeof fetch {
  return (async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== FAKE_STOREFRONT_URL) throw new Error("Unexpected destination");
    return storefront.handle(request);
  }) as typeof fetch;
}
