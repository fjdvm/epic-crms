import { describe, expect, it, vi } from "vitest";

import { recordPlacementAudit, safeReason } from "@/features/orders/placement-audit";
import type { AuditEvent } from "@/lib/audit-trail";

const at = new Date("2026-11-18T01:00:00Z");
const run = async (orders: { id: number; created_at: Date }[], outcomes: { order_id: number; kind: string; status: string; reason: string | null; updated_at: Date }[]) => {
  const events: AuditEvent[] = [];
  await recordPlacementAudit(async (e) => { events.push(e); }, orders, outcomes);
  return events;
};

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

  it("a throwing audit port does not stop the sweep", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const audit = vi.fn(async () => { throw new Error("down"); });
    await expect(recordPlacementAudit(audit, [{ id: 1, created_at: at }, { id: 2, created_at: at }], [])).resolves.toEqual({ placed: 2, emails: 0 });
    expect(audit).toHaveBeenCalledTimes(2);
  });
});
