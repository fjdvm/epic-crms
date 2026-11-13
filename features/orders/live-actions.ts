"use server";

import { getShell } from "@/lib/portal/staff";

/** Only signed-in Staff can obtain a single-use pass for the payload-free Orders channel. */
export async function staffOrdersLiveUrl(): Promise<string | null> {
  const { staff } = await getShell();
  try {
    const base = process.env.CREOMS_GATEWAY_URL?.replace(/\/$/, "");
    const key = process.env.CREOMS_GATEWAY_CALLER_KEY;
    if (!base || !key) throw new Error("Staff live gateway is not configured");
    const response = await fetch(`${base}/live-tickets`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: staff.id, channel: "staff-orders" }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Staff Orders Live ticket refused: ${response.status}`);
    const { ticket } = await response.json();
    if (typeof ticket !== "string" || !ticket) throw new Error("Staff Orders Live ticket is missing");
    return `${base.replace(/^http/, "ws")}/notifications/orders/staff/live?ticket=${encodeURIComponent(ticket)}`;
  } catch (error) {
    console.error("Staff Orders live connection unavailable", error);
    return null;
  }
}
