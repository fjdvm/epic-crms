import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_PICKUP } from "@/features/settings/pickup-instructions";

const mocks = vi.hoisted(() => ({ validateSession: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/portal/client", () => ({ validateSession: mocks.validateSession }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/features/settings/pickup-instructions", async importOriginal => ({
  ...(await importOriginal<typeof import("@/features/settings/pickup-instructions")>()),
  loadPickupInstructions: mocks.load,
}));
vi.mock("@/features/settings/pickup-instructions-server", () => ({ savePickupInstructions: mocks.save }));

import { GET, PUT } from "@/app/api/pickup-instructions/route";

const request = (method: string, auth: string | null = "Bearer h", body?: unknown) =>
  new Request("http://x/api/pickup-instructions", { method, headers: auth ? { authorization: auth } : {}, body: body ? JSON.stringify(body) : undefined });
const as = (role: string) => mocks.validateSession.mockResolvedValue({ decision: "allowed", staff: { id: "s", name: "S", role } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(EMPTY_PICKUP);
  mocks.save.mockImplementation(async (_s, _a, staff) =>
    staff.role === "Super Admin" ? { ok: true, instructions: EMPTY_PICKUP } : { ok: false, reason: "Only an Admin can change the Pickup instructions." });
});

describe("/api/pickup-instructions", () => {
  it.each(["Super Admin", "CEO", "CRMS Manager"])("lets %s read", async role => {
    as(role);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect((await response.json()).instructions).toEqual(EMPTY_PICKUP);
  });

  it("refuses Staff both ways, and a missing sign-in", async () => {
    as("Staff/Employee");
    expect((await GET(request("GET"))).status).toBe(403);
    expect((await PUT(request("PUT", "Bearer h", EMPTY_PICKUP))).status).toBe(403);
    expect((await GET(request("GET", null))).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves for an Admin only; CEO and Manager can read but are refused a save", async () => {
    as("Super Admin");
    expect((await PUT(request("PUT", "Bearer h", EMPTY_PICKUP))).status).toBe(200);
    for (const role of ["CEO", "CRMS Manager"]) {
      as(role);
      expect((await PUT(request("PUT", "Bearer h", EMPTY_PICKUP))).status).toBe(403);
    }
  });
});
