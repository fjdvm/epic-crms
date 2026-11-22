import { beforeEach, describe, expect, it, vi } from "vitest";

const requireModule = vi.fn();
vi.mock("@/lib/portal/staff", () => ({ requireModule }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: vi.fn(() => { throw new Error("must not be reached"); }), ticketsWriterDatabase: vi.fn(() => { throw new Error("must not be reached"); }) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: vi.fn(() => { throw new Error("must not be reached"); }) }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/features/notifications/portal-gateway", () => ({ portalGateway: () => ({ recipients: vi.fn(async () => { throw new Error("must not be reached"); }) }) }));
vi.mock("@/features/notifications/staff-live", () => ({ nudgeStaff: vi.fn() }));
vi.mock("@/features/notifications/sync", () => ({ syncNotificationCopies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const { absentTickets, reassignAll, reassignOne, reassignOptions } = await import("@/features/tickets/reassign-actions");

describe("Reassign actions by URL or direct call", () => {
  beforeEach(() => requireModule.mockReset());

  for (const role of ["Staff", "Super Admin", "CEO"]) {
    it(`refuse a ${role} before touching any data`, async () => {
      requireModule.mockResolvedValue({ id: "u", name: "X", username: "x", role });

      expect(await reassignOne(1, "liza", "rhea", "why", "op")).toEqual({ ok: false, reason: "forbidden" });
      expect(await reassignAll([1], "liza", "rhea", "why", "op")).toEqual({ ok: false, reason: "forbidden" });
      expect(await reassignOptions()).toEqual({ ok: false, reason: "forbidden" });
      expect(await absentTickets("liza")).toEqual({ ok: false, reason: "forbidden" });
    });
  }
});
