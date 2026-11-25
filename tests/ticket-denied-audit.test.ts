import { beforeEach, describe, expect, it, vi } from "vitest";

// Denied and failed attempts, and the new success events, at the action boundary (#749). The domain modules are
// replaced so each case drives exactly one outcome; the events are read from the injected AuditTrail.
const mocks = vi.hoisted(() => ({
  audit: vi.fn(async (_event: import("@/lib/audit-trail").AuditEvent) => {}),
  requireModule: vi.fn(),
  escalateTicket: vi.fn(),
  reassignTickets: vi.fn(),
  openTicket: vi.fn(),
}));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: mocks.audit, gatewayFileStorage: {}, storefrontTicketUrl: vi.fn(), sendAppEmail: vi.fn() }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => "reader", ticketsWriterDatabase: () => "writer" }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => "crms" }));
vi.mock("@/features/tickets/escalate", () => ({ escalateTicket: mocks.escalateTicket, takeEscalation: vi.fn(), sendBackEscalation: vi.fn() }));
vi.mock("@/features/tickets/reassign", () => ({ reassignTickets: mocks.reassignTickets, claimerWorkload: vi.fn(), ticketsHeldBy: vi.fn() }));
vi.mock("@/features/tickets/new-ticket", () => ({ openTicket: mocks.openTicket, searchCustomers: vi.fn(), customerOrders: vi.fn() }));
vi.mock("@/features/notifications/portal-gateway", () => ({
  portalGateway: () => ({ recipients: async () => [{ username: "rhea", name: "Rhea", role: "Staff", modules: ["Tickets"] }] }),
}));
vi.mock("@/features/notifications/staff-live", () => ({ nudgeStaff: vi.fn() }));
vi.mock("@/features/notifications/sync", () => ({ syncNotificationCopies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { openNewTicket } from "@/features/tickets/actions";
import { escalate } from "@/features/tickets/escalate-actions";
import { reassignAll } from "@/features/tickets/reassign-actions";

const staff = { id: "portal-1", username: "ana", name: "Ana", role: "Staff" };
const manager = { id: "portal-2", username: "mara", name: "Mara", role: "CREOMS Manager" };
const events = () => mocks.audit.mock.calls.map(([e]) => e);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModule.mockResolvedValue(staff);
});

describe("escalation attempts", () => {
  it("records a refused escalation once per replay, with the reason and no note text", async () => {
    mocks.escalateTicket.mockResolvedValue({ ok: false, reason: "not-claimer" });
    expect(await escalate(5, "money", "private note", "tok")).toEqual({ ok: false, reason: "not-claimer" });
    await escalate(5, "money", "private note", "tok");
    const [first, second] = events();
    expect(first).toMatchObject({ action: "ticket.escalated", outcome: "failure", actor: { id: "portal-1", display_name: "Ana" }, target: { type: "ticket", id: "5" }, metadata: { reason: "not-claimer" } });
    expect(first.operationId).toBe(second.operationId);
    expect(JSON.stringify(events())).not.toContain("private note");
  });

  it("records a read-only Role's attempt without touching data", async () => {
    mocks.requireModule.mockResolvedValue({ ...staff, role: "Admin" });
    expect(await escalate(5, "money", "x")).toEqual({ ok: false, reason: "read-only" });
    expect(mocks.escalateTicket).not.toHaveBeenCalled();
    expect(events()).toMatchObject([{ action: "ticket.escalated", outcome: "failure", metadata: { reason: "read-only" } }]);
  });

  it("records a failure when the save throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.escalateTicket.mockRejectedValue(new Error("db down"));
    expect(await escalate(5, "money", "x")).toEqual({ ok: false, reason: "unavailable" });
    expect(events()).toMatchObject([{ outcome: "failure", metadata: { reason: "unavailable" } }]);
  });
});

describe("reassign attempts", () => {
  it("records a Staff attempt to move Tickets as denied, listing ids only", async () => {
    expect(await reassignAll([1, 2], "liza", "rhea", "private reason", "op-1")).toEqual({ ok: false, reason: "forbidden" });
    await reassignAll([1, 2], "liza", "rhea", "private reason", "op-1");
    const [first, second] = events();
    expect(first).toMatchObject({ action: "ticket.reassigned", outcome: "failure", target: { type: "ticket", id: "1" }, metadata: { reason: "forbidden", ticketIds: [1, 2], bulk: true, toId: "rhea" } });
    expect(first.operationId).toBe(second.operationId);
    expect(JSON.stringify(events())).not.toContain("private reason");
    expect(mocks.reassignTickets).not.toHaveBeenCalled();
  });

  it("records a refused move by a Manager and leaves a saved move to the success event", async () => {
    mocks.requireModule.mockResolvedValue(manager);
    mocks.reassignTickets.mockResolvedValueOnce({ ok: false, reason: "claimer-changed" });
    await reassignAll([7], "liza", "rhea", "cover", "op-2");
    mocks.reassignTickets.mockResolvedValueOnce({ ok: true, moved: [7], skipped: [] });
    await reassignAll([7], "liza", "rhea", "cover", "op-3");
    expect(events()).toMatchObject([{ action: "ticket.reassigned", outcome: "failure", metadata: { reason: "claimer-changed" } }]);
    await reassignAll([7], "liza", "nobody", "cover", "op-4");
    expect(events()[1]).toMatchObject({ outcome: "failure", metadata: { reason: "invalid-recipient" } });
  });
});

describe("opening a Ticket", () => {
  const form = () => {
    const f = new FormData();
    f.set("subject", "Cracked lid"); f.set("customerId", "c2"); f.set("description", "Secret text"); f.set("priority", "high"); f.set("orderId", "12");
    return f;
  };

  it("records ticket.opened with ids only", async () => {
    mocks.openTicket.mockResolvedValue({ ok: true, id: 209, emailed: null });
    await openNewTicket(form());
    expect(events()).toMatchObject([{ action: "ticket.opened", outcome: "success", target: { type: "ticket", id: "209", display_name: "TKT-209" }, metadata: { customerId: "c2", orderId: 12, priority: "high" }, operationId: JSON.stringify(["opened", 209]) }]);
    expect(JSON.stringify(events())).not.toContain("Secret text");
    expect(JSON.stringify(events())).not.toContain("Cracked lid");
  });

  it("records a refusal and a read-only attempt as failures", async () => {
    mocks.openTicket.mockResolvedValue({ ok: false, reason: "unknown-customer" });
    await openNewTicket(form());
    mocks.requireModule.mockResolvedValue({ ...staff, role: "Admin" });
    await openNewTicket(form());
    expect(events()).toMatchObject([
      { action: "ticket.opened", outcome: "failure", target: { type: "customer", id: "c2" }, metadata: { reason: "unknown-customer" } },
      { action: "ticket.opened", outcome: "failure", metadata: { reason: "read-only" } },
    ]);
  });
});
