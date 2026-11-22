"use server";

import { ORDERS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

import { readPublishedContent, stockMirror } from "./published-content";
import { loadStock, loadStockSize, type StockResult, type StockSizeResult } from "./stock";

/** A single-use pass for the Staff stock channel, issued only to Staff who hold the Orders Module. */
export async function staffStockLiveUrl(): Promise<string | null> {
  const staff = await requireModule(ORDERS_MODULE);
  try {
    const base = process.env.CREOMS_GATEWAY_URL?.replace(/\/$/, "");
    const key = process.env.CREOMS_GATEWAY_CALLER_KEY;
    if (!base || !key) throw new Error("Staff live gateway is not configured");
    const response = await fetch(`${base}/live-tickets`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: staff.id, channel: "staff-stock" }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Staff stock Live ticket refused: ${response.status}`);
    const { ticket } = await response.json();
    if (typeof ticket !== "string" || !ticket) throw new Error("Staff stock Live ticket is missing");
    return `${base.replace(/^http/, "ws")}/notifications/stock/staff/live?ticket=${encodeURIComponent(ticket)}`;
  } catch (error) {
    console.error("Staff stock live connection unavailable", error);
    return null;
  }
}

/** Everything again, after a connect or reconnect. */
export async function refetchStock(): Promise<StockResult> {
  await requireModule(ORDERS_MODULE);
  return loadStock(ticketsDatabase, undefined, undefined, readPublishedContent, stockMirror);
}

/** One Size again, after the IMS announced a change to it. */
export async function refetchStockSize(sizeId: number): Promise<StockSizeResult> {
  await requireModule(ORDERS_MODULE);
  if (!Number.isSafeInteger(sizeId)) return { ok: false };
  return loadStockSize(ticketsDatabase, sizeId, undefined, undefined, readPublishedContent, stockMirror);
}
