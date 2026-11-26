import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({ spans: [] as unknown[], fail: false }));
vi.mock("@/lib/db", () => ({ database: () => ({}) }));
vi.mock("@/features/pos-sales/sales", () => ({
  posSalesIn: async (_sql: unknown, span: unknown) => {
    if (read.fail) throw new Error("db down");
    read.spans.push(span);
    return { sales: 15000, orders: 1, products: [{ imsProductId: 22, productName: "Ube Halaya", sizeLabel: "500g", unitsSold: 2, sales: 10000 }], otherSales: 5000 };
  },
}));

import { GET } from "@/app/api/internal/pos-sales/route";

const secret = "pos-creoms-secret-at-least-thirty-two-chars";
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(over: Record<string, unknown> = {}, key = secret) {
  const iat = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: "pos", aud: "creoms-sales", scope: "sales:read", iat, exp: iat + 300, ...over })}`;
  return `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
}
const get = (query = "from=2026-11-01&to=2026-11-02", authorization: string | null = `Bearer ${token()}`) =>
  GET(new NextRequest(`https://creoms.test/api/internal/pos-sales?${query}`, { headers: authorization ? { Authorization: authorization } : {} }));

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-26T04:00:00Z"), toFake: ["Date"] });
  vi.stubEnv("POS_CREOMS_SECRET", secret);
  read.spans = []; read.fail = false;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("POS online sales feed", () => {
  it("returns the online Sales for whole Philippine days, never cached", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      from: "2026-11-01", to: "2026-11-02", timeZone: "Asia/Manila", currency: "PHP", sales: 15000, orders: 1,
      products: [{ imsProductId: 22, productName: "Ube Halaya", sizeLabel: "500g", unitsSold: 2, sales: 10000 }], otherSales: 5000,
    });
    expect(read.spans).toEqual([{ start: new Date("2026-10-31T16:00:00Z"), end: new Date("2026-11-02T16:00:00Z") }]);
  });

  it("accepts the previous secret while it rotates", async () => {
    vi.stubEnv("POS_CREOMS_SECRET", "a-brand-new-secret-of-at-least-thirty-two");
    vi.stubEnv("POS_CREOMS_SECRET_PREVIOUS", secret);
    expect((await get()).status).toBe(200);
  });

  it("refuses a missing, wrongly signed, expired or other-purpose credential, and the IMS's stock credential", async () => {
    const iat = Math.floor(Date.now() / 1000) - 3600;
    for (const authorization of [null, "Bearer nope", `Bearer ${token({}, "another-secret-of-at-least-thirty-two-chars")}`,
      `Bearer ${token({ iat, exp: iat + 300 })}`, `Bearer ${token({ exp: Math.floor(Date.now() / 1000) + 3600 })}`,
      `Bearer ${token({ aud: "creoms-stock" })}`, `Bearer ${token({ scope: "stock:push" })}`, `Bearer ${token({ iss: "ims" })}`,
      `Bearer ${token({ iss: "ims", aud: "creoms-stock", scope: "stock:push" })}`]) {
      expect((await get(undefined, authorization)).status, String(authorization)).toBe(401);
    }
    expect(read.spans).toEqual([]);
  });

  it("refuses every credential while the secret is unset or too short", async () => {
    vi.stubEnv("POS_CREOMS_SECRET", "");
    expect((await get()).status).toBe(401);
    vi.stubEnv("POS_CREOMS_SECRET", "short");
    expect((await get(undefined, `Bearer ${token({}, "short")}`)).status).toBe(401);
  });

  it("refuses dates that are missing, not real, reversed or too long", async () => {
    for (const query of ["", "from=2026-11-01", "from=2026-11-1&to=2026-11-02", "from=2026-02-30&to=2026-03-01",
      "from=2026-11-02&to=2026-11-01", "from=2025-11-01&to=2026-11-02"]) {
      const response = await get(query);
      expect(response.status, query).toBe(400);
      expect((await response.json()).error).toMatch(/YYYY-MM-DD/);
    }
    expect((await get("from=2025-11-26&to=2026-11-26")).status).toBe(200);
    expect((await get("from=2026-11-01&to=2026-11-30")).status).toBe(200);
  });

  it("says the sales are unavailable when the shop database cannot be read", async () => {
    read.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "sales unavailable" });
  });
});
