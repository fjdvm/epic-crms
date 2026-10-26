import { portalConfig } from "@/lib/portal/config";
import type { PortalCopies } from "./portal-copies";

type Remote = { id: string; type: string; sendingApp: string; readAt: string | null };

/** Exact lookups keep retries and linked reads independent of inbox size. */
export function portalGateway(): PortalCopies {
  const deadline = AbortSignal.timeout(4_000);
  async function call(path: string, body?: object) {
    const base = process.env.CREOMS_GATEWAY_URL?.replace(/\/$/, "");
    const key = process.env.CREOMS_GATEWAY_CALLER_KEY;
    if (!base || !key) throw new Error("Portal copies gateway is not configured");
    const response = await fetch(`${base}/notifications/notifications${path}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store", redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(3_000)]),
    });
    if (!response.ok) throw new Error(`Portal copies gateway refused: ${response.status}`);
    return response.json();
  }
  async function lookup(userId: string, query: Record<string, string>): Promise<Remote | null> {
    const params = new URLSearchParams({ userId, app: "Portal", ...query });
    const result: { notification: Remote | null } = await call(`/lookup?${params}`);
    return result.notification;
  }
  return {
    async recipients() {
      const config = portalConfig();
      const response = await fetch(`${config.portalUrl}/api/integrations/recipients`, {
        method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.systemName}:${config.systemSecret}`).toString("base64")}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(3_000)]),
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
      // A retry returns no newly inserted rows. Recover the original by its indexed key.
      const remote = result.notifications[0] ?? await lookup(copy.userId, { idempotencyKey: copy.key, sendingApp: "CREOMS" });
      if (!remote) throw new Error("Portal copy was not returned");
      return { id: remote.id, read: remote.readAt !== null };
    },
    async find(userId, key) {
      const remote = await lookup(userId, { idempotencyKey: key, sendingApp: "CREOMS" });
      return remote ? { id: remote.id, read: remote.readAt !== null } : null;
    },
    async status(userId, id) {
      const remote = await lookup(userId, { id });
      if (!remote) throw new Error("Portal copy was not found");
      return { id: remote.id, read: remote.readAt !== null };
    },
    async markRead(userId, id) { await call(`/${encodeURIComponent(id)}/read`, { userId, app: "Portal" }); },
  };
}
