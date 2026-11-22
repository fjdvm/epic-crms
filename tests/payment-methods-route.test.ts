import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ availability: vi.fn() }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/features/management/payment-accounts", () => ({ listMethodAvailability: mocks.availability }));

import { GET } from "@/app/api/payment-methods/route";

const SECRET = "s".repeat(40);
const call = (auth: string | null) => GET(new Request("http://x/api/payment-methods", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CREOMS_SERVICE_SECRET = SECRET;
  mocks.availability.mockResolvedValue({ gcash: true, maya: false, bank_transfer: true });
});

describe("/api/payment-methods", () => {
  it("returns only per-method booleans to the storefront", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, methods: { gcash: true, maya: false, bank_transfer: true } });
  });
  it.each([null, "Bearer wrong", "Basic abc"])("refuses %j", async (auth) => {
    expect((await call(auth)).status).toBe(401);
    expect(mocks.availability).not.toHaveBeenCalled();
  });
  it("refuses everyone when no secret is configured", async () => {
    delete process.env.CREOMS_SERVICE_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
  });
  it("answers 503 when the database is unavailable", async () => {
    mocks.availability.mockRejectedValue(new Error("down"));
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });
});
