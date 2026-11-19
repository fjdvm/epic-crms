/** The shared line every open storefront page listens on, signed in or not. It carries no data: pages refetch what they show. */
export const STOREFRONT_CHANNEL = "storefront-public";

/**
 * Tells open storefront pages that a shop setting changed (the Free delivery threshold in the banner), through the
 * gateway's notification service and its WebSocket. Never carries the new value: pages read it fresh.
 */
export async function nudgeStorefront(): Promise<void> {
  const base = process.env.CREOMS_GATEWAY_URL?.replace(/\/$/, "");
  const key = process.env.CREOMS_GATEWAY_CALLER_KEY;
  if (!base || !key) throw new Error("Storefront live gateway is not configured");
  const response = await fetch(`${base}/notifications/notifications`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      type: "storefront.settings.changed", title: "Shop settings changed", body: "Refresh what the shop shows.",
      sendingApp: "crms", targetApp: "ecommerce", userIds: [STOREFRONT_CHANNEL],
    }),
  });
  if (!response.ok) throw new Error(`Storefront nudge refused: ${response.status}`);
}
