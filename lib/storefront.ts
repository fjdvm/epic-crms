import { createHmac } from "node:crypto";

export type OrderStatusUpdate = { status: "confirmed" | "cancelled" | "preparing" | "dispatched" | "delivered"; deliveryFeeInCentavos?: number };
export type OrderChangeResult =
  | { ok: true; order: { id: number; status: string; deliveryFeeInCentavos: number | null } }
  | { ok: false; reason: string };

/** Mint the storefront's scoped, five-minute HS256 credential for this request. Never sent to a browser. */
function credential(secret: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "creoms", aud: "brenraphaels-orders", scope: "orders:status", iat, exp: iat + 300,
  })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

/** The storefront owns all Order writes and Customer emails. Never retry an uncertain write automatically. */
export async function changeOrderStatus(id: number, update: OrderStatusUpdate): Promise<OrderChangeResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/status`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify(update), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body.error === "string" ? body.error : "Storefront refused the change." };
    if (body.id !== id || body.status !== update.status ||
      (update.deliveryFeeInCentavos !== undefined && body.deliveryFeeInCentavos !== update.deliveryFeeInCentavos) ||
      !(body.deliveryFeeInCentavos === null || Number.isSafeInteger(body.deliveryFeeInCentavos))) {
      return { ok: false, reason: "Storefront did not confirm the change. Refresh the Order before trying again." };
    }
    return { ok: true, order: { id: body.id, status: body.status, deliveryFeeInCentavos: body.deliveryFeeInCentavos } };
  } catch {
    return { ok: false, reason: "Storefront could not confirm the change. Refresh the Order before trying again." };
  }
}
