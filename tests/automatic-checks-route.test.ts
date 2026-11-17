import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AUTOMATIC_CHECKS } from "@/features/settings/automatic-checks";

const mocks = vi.hoisted(() => ({ validateSession: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/portal/client", () => ({ validateSession: mocks.validateSession }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/features/settings/automatic-checks", async importOriginal => ({
  ...(await importOriginal<typeof import("@/features/settings/automatic-checks")>()),
  loadAutomaticChecks: mocks.load,
}));
vi.mock("@/features/settings/automatic-checks-server", () => ({ saveAutomaticChecks: mocks.save }));

import { GET, PUT } from "@/app/api/automatic-checks/route";

const request = (method: string, auth: string | null = "Bearer h", body?: unknown) =>
  new Request("http://x/api/automatic-checks", { method, headers: auth ? { authorization: auth } : {}, body: body ? JSON.stringify(body) : undefined });
const as = (role: string) => mocks.validateSession.mockResolvedValue({ decision: "allowed", staff: { id: "s", name: "S", role } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(DEFAULT_AUTOMATIC_CHECKS);
  mocks.save.mockImplementation(async (_s, _a, staff) =>
    staff.role === "Super Admin" ? { ok: true, checks: DEFAULT_AUTOMATIC_CHECKS } : { ok: false, reason: "Only an Admin can change the Automatic checks." });
});

describe("/api/automatic-checks", () => {
  it.each(["Super Admin", "CEO", "CRMS Manager"])("lets %s read", async role => {
    as(role);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect((await response.json()).checks).toEqual(DEFAULT_AUTOMATIC_CHECKS);
  });

  it("refuses Staff both ways, and a missing sign-in", async () => {
    as("Staff/Employee");
    expect((await GET(request("GET"))).status).toBe(403);
    expect((await PUT(request("PUT", "Bearer h", DEFAULT_AUTOMATIC_CHECKS))).status).toBe(403);
    expect((await GET(request("GET", null))).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves for an Admin only; CEO and Manager can read but are refused a save", async () => {
    as("Super Admin");
    expect((await PUT(request("PUT", "Bearer h", DEFAULT_AUTOMATIC_CHECKS))).status).toBe(200);
    for (const role of ["CEO", "CRMS Manager"]) {
      as(role);
      expect((await PUT(request("PUT", "Bearer h", DEFAULT_AUTOMATIC_CHECKS))).status).toBe(403);
    }
  });
});
