import { portalConfig } from "@/lib/portal/config";
import type { PortalCopies } from "./portal-copies";

type Remote = { id: string; type: string; sendingApp: string; readAt: string | null };

/** One sync's inbox pages are reused across copies, including recovery of an uncertain send. */
export function portalGateway(): PortalCopies {
  const inboxes = new Map<string, Promise<Remote[]>>();
  async function call(path: string, body?: object) {
    const base = process.env.CREOMS_GATEWAY_URL?.replace(/\/$/, "");
    const key = process.env.CREOMS_GATEWAY_CALLER_KEY;
    if (!base || !key) throw new Error("Portal copies gateway is not configured");
    const response = await fetch(`${base}/notifications/notifications${path}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Portal copies gateway refused: ${response.status}`);
    return response.json();
  }
  function inbox(userId: string): Promise<Remote[]> {
    let pending = inboxes.get(userId);
    if (!pending) {
      pending = (async () => {
        const rows: Remote[] = [];
        let cursor: string | null = null;
        do {
          const query = new URLSearchParams({ userId, app: "Portal", limit: "100", ...(cursor ? { cursor } : {}) });
          const page: { notifications: Remote[]; nextCursor: string | null } = await call(`?${query}`);
          rows.push(...page.notifications);
          cursor = page.nextCursor;
        } while (cursor);
        return rows;
      })();
      inboxes.set(userId, pending);
    }
    return pending;
  }
  return {
    async recipients() {
      const config = portalConfig();
      const response = await fetch(`${config.portalUrl}/api/integrations/recipients`, {
        method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.systemName}:${config.systemSecret}`).toString("base64")}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error(`Portal recipients refused: ${response.status}`);
      const body: { staff: { id: string; modules: string[] }[] } = await response.json();
      return body.staff;
    },
    async send(copy) {
      const result: { notifications: Remote[] } = await call("", {
        idempotencyKey: copy.key, type: copy.key, title: copy.text, body: copy.text, link: copy.link,
        sendingApp: "CREOMS", targetApp: "Portal", userIds: [copy.userId],
      });
      // A retry returns no newly inserted rows. Recover the original from every inbox page.
      inboxes.delete(copy.userId);
      const remote = result.notifications[0] ?? (await inbox(copy.userId)).find(row => row.type === copy.key && row.sendingApp === "CREOMS");
      if (!remote) throw new Error("Portal copy was not returned");
      return { id: remote.id, read: remote.readAt !== null };
    },
    async status(userId, id) {
      const remote = (await inbox(userId)).find(row => row.id === id && row.sendingApp === "CREOMS");
      if (!remote) throw new Error("Portal copy was not found");
      return { id: remote.id, read: remote.readAt !== null };
    },
    async markRead(userId, id) { await call(`/${encodeURIComponent(id)}/read`, { userId, app: "Portal" }); },
  };
}
