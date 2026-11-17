import { describe, expect, it, vi } from "vitest";

import { emailEvent, placedEvent, safeReason, syncOrderAudit } from "@/features/orders/placement-audit";
import type { AuditEvent } from "@/lib/audit-trail";

const at = new Date("2026-11-18T01:00:00Z");
type Outcome = { order_id: number; kind: string; status: string; reason: string | null; updated_at: Date };
const run = async (orders: { id: number; created_at: Date }[], outcomes: Outcome[]) =>
  [...orders.map(placedEvent), ...outcomes.map(emailEvent).filter((e): e is AuditEvent => e !== null)];

describe("order placement audit", () => {
  it("records order.placed with a stable operation id per Order", async () => {
    const [a] = await run([{ id: 7, created_at: at }], []);
    const [b] = await run([{ id: 7, created_at: at }], []);
    expect(a).toMatchObject({ action: "order.placed", outcome: "success", target: { id: "7" }, occurred_at: at.toISOString() });
    expect(a.operationId).toBe(b.operationId);
  });

  it("records a sent email as success and a failed one as failure with its reason", async () => {
    const events = await run([], [
      { order_id: 7, kind: "confirmation", status: "sent", reason: null, updated_at: at },
      { order_id: 8, kind: "confirmation", status: "failed", reason: "mailbox full", updated_at: at },
    ]);
    expect(events[0]).toMatchObject({ action: "order.email_sent", outcome: "success" });
    expect(events[1]).toMatchObject({ action: "order.email_failed", outcome: "failure", metadata: { reason: "mailbox full" } });
  });

  it("writes one entry per outcome change: failed then sent differ, a repeated failure does not", async () => {
    const failed = { order_id: 7, kind: "confirmation", status: "failed", reason: "x", updated_at: at };
    const events = await run([], [failed, { ...failed, updated_at: new Date() }, { ...failed, status: "sent" }]);
    expect(events[0].operationId).toBe(events[1].operationId);
    expect(events[2].operationId).not.toBe(events[0].operationId);
  });

  it("writes nothing for an email still pending or retrying", async () => {
    expect(await run([], [{ order_id: 7, kind: "confirmation", status: "pending", reason: null, updated_at: at }])).toEqual([]);
  });

  it("never includes a Customer's email address", async () => {
    expect(safeReason("550 jane.doe@example.com rejected")).toBe("550 [email removed] rejected");
    const events = await run([], [{ order_id: 7, kind: "confirmation", status: "failed", reason: "bounce for jane@example.com", updated_at: at }]);
    expect(JSON.stringify(events)).not.toContain("jane@example.com");
  });

  const ports = (orders: { id: number; created_at: Date }[], outcomes: Outcome[], ledger = new Set<string>(), deliver: (e: AuditEvent) => Promise<void> = vi.fn(async () => {})) => ({
    orders: async () => orders, outcomes: async () => outcomes, deliver,
    delivered: async (ids: string[]) => new Set(ids.filter((id) => ledger.has(id))),
    markDelivered: async (id: string) => { ledger.add(id); },
  });

  it("delivers each event once, however often the storefront signals", async () => {
    const deliver = vi.fn(async () => {});
    const p = ports([{ id: 1, created_at: at }], [{ order_id: 1, kind: "confirmation", status: "sent", reason: null, updated_at: at }], new Set(), deliver);
    expect(await syncOrderAudit(p)).toEqual({ delivered: 2, failed: 0 });
    expect(await syncOrderAudit(p)).toEqual({ delivered: 0, failed: 0 });
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("keeps a refused delivery for the next signal and does not stop the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ledger = new Set<string>();
    let refuse = true;
    const deliver = vi.fn(async (e: AuditEvent) => { if (refuse && e.target.id === "1") throw new Error("down"); });
    const p = ports([{ id: 1, created_at: at }, { id: 2, created_at: at }], [], ledger, deliver);
    expect(await syncOrderAudit(p)).toEqual({ delivered: 1, failed: 1 });
    refuse = false;
    expect(await syncOrderAudit(p)).toEqual({ delivered: 1, failed: 0 });
    expect(ledger.size).toBe(2);
  });

  it("a sent email recorded after a failed one is a second entry", async () => {
    const deliver = vi.fn(async () => {});
    const ledger = new Set<string>();
    const row = { order_id: 1, kind: "confirmation", status: "failed", reason: "x", updated_at: at };
    await syncOrderAudit(ports([], [row], ledger, deliver));
    await syncOrderAudit(ports([], [{ ...row, status: "sent" }], ledger, deliver));
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});
