import { beforeEach, describe, expect, it, vi } from "vitest";

// Refused and failed Customer note and Task attempts, and the notes read (#751), read from the injected AuditTrail.
const mocks = vi.hoisted(() => ({
  audit: vi.fn(async (_event: import("@/lib/audit-trail").AuditEvent) => {}),
  requireModule: vi.fn(),
  crms: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: mocks.audit, deliverGatewayAuditEvent: vi.fn() }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: mocks.crms }));
vi.mock("@/lib/db", () => ({ database: () => { throw new Error("db down"); } }));
vi.mock("@/features/notifications/portal-gateway", () => ({ portalGateway: () => ({ recipients: async () => [] }) }));
vi.mock("@/features/customer-profiles/notes", async (orig) => ({ ...(await orig<object>()), listCustomerNotes: mocks.list }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addCustomerNote, readCustomerNotes } from "@/features/customer-profiles/note-actions";
import { changeCustomerTaskDueDate, createCustomerTask } from "@/features/customer-profiles/task-actions";

const staff = { id: "portal-1", username: "ana", name: "Ana", role: "Staff" };
const admin = { id: "portal-9", username: "ada", name: "Ada", role: "Admin" };
const events = () => mocks.audit.mock.calls.map(([e]) => e);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModule.mockResolvedValue(staff);
});

describe("Customer note attempts", () => {
  it("records a view-only Role once per replay, without note text", async () => {
    mocks.requireModule.mockResolvedValue(admin);
    await addCustomerNote("c1", "secret text", "op-1");
    await addCustomerNote("c1", "secret text", "op-1");
    const [a, b] = events();
    expect(a).toMatchObject({ module: "Customer Profiles", action: "customer_note.created", outcome: "failure", actor: { id: "portal-9" }, target: { type: "customer_profile", id: "c1" }, metadata: { reason: "read-only" } });
    expect(a.operationId).toBe(b.operationId);
    expect(JSON.stringify(a)).not.toContain("secret");
  });

  it("records validation refusals and an unavailable save", async () => {
    await addCustomerNote("c1", "  ", "op-2");
    expect(events()[0]).toMatchObject({ outcome: "failure", metadata: { reason: "empty-note" } });
    mocks.crms.mockImplementation(() => { throw new Error("down"); });
    await addCustomerNote("c1", "hello", "op-3");
    expect(events()[1]).toMatchObject({ outcome: "failure", metadata: { reason: "unavailable" } });
  });

  it("records the notes read once a minute per person and Customer", async () => {
    mocks.crms.mockReturnValue("sql");
    mocks.list.mockResolvedValue([]);
    await readCustomerNotes("c1");
    await readCustomerNotes("c1");
    expect(events()[0]).toMatchObject({ action: "customer_note.viewed", outcome: "success", target: { id: "c1" } });
    expect(events()[0].operationId).toBe(events()[1].operationId);
  });
});

describe("Customer Task attempts", () => {
  it("records a view-only Role's attempt, with the Task id only", async () => {
    mocks.requireModule.mockResolvedValue(admin);
    const taskId = "11111111-1111-1111-1111-111111111111";
    await changeCustomerTaskDueDate("c1", taskId, "2026-12-01", "op-4");
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ action: "customer_task.due_date_changed", outcome: "failure", metadata: { reason: "your-role-can-only-view-shop-work", taskId } });
  });

  it("records a Staff attempt that needs a Manager and a failed save", async () => {
    await createCustomerTask("c1", { description: "Call", dueDate: "2026-12-01", owner: { id: "other", name: "Bo" } }, "op-5");
    expect(events()[0]).toMatchObject({ action: "customer_task.created", outcome: "failure" });
    expect(events()[0].metadata?.reason).toMatch(/request-approval/);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await createCustomerTask("c1", { description: "Call", dueDate: "2026-12-01" }, "op-6");
    expect(events()[1]).toMatchObject({ outcome: "failure", metadata: { reason: "unavailable" } });
  });
});
