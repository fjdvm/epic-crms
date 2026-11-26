import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applied = vi.hoisted(() => ({ calls: [] as unknown[], deleted: [] as number[], result: true, fail: false }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/features/orders/stock-count", () => ({
  applyImsFigures: async (_sql: unknown, push: unknown) => {
    if (applied.fail) throw new Error("db down");
    applied.calls.push(push);
    return applied.result;
  },
  deleteMirrorOne: async (_sql: unknown, productId: number) => {
    if (applied.fail) throw new Error("db down");
    applied.deleted.push(productId);
  },
}));

import { DELETE, POST } from "@/app/api/internal/ims-stock/route";

const secret = "ims-creoms-secret-at-least-thirty-two-chars";
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(over: Record<string, unknown> = {}, key = secret) {
  const iat = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: "ims", aud: "creoms-stock", scope: "stock:push", iat, exp: iat + 300, ...over })}`;
  return `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
}
const body = { productId: 22, name: "Ube Halaya Smooth", variant: "500g", image: null, price: 399, active: true, quantity: 10, reserved: 3, available: 7, version: "1763900000000000" };
const post = (payload: unknown, authorization: string | null = `Bearer ${token()}`) => POST(new NextRequest("https://creoms.test/api/internal/ims-stock", {
  method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(payload),
}));

beforeEach(() => { vi.stubEnv("IMS_CREOMS_SECRET", secret); applied.calls = []; applied.deleted = []; applied.result = true; applied.fail = false; });
afterEach(() => { vi.unstubAllEnvs(); });

describe("IMS stock push", () => {
  it("saves the IMS's figures for the Size", async () => {
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: true });
    expect(applied.calls).toEqual([{ productId: 22, name: "Ube Halaya Smooth", variant: "500g", image: null, price: 399, active: true, quantity: 10, reserved: 3, available: 7, version: BigInt(1763900000000000) }]);
  });

  it("accepts an older push and says it was ignored", async () => {
    applied.result = false;
    expect(await (await post(body)).json()).toEqual({ applied: false });
  });

  it("refuses a missing, wrongly signed, expired or other-purpose credential, and an unset secret", async () => {
    const iat = Math.floor(Date.now() / 1000) - 3600;
    for (const authorization of [null, "Bearer nope", `Bearer ${token({}, "another-secret-of-at-least-thirty-two-chars")}`, `Bearer ${token({ iat, exp: iat + 300 })}`,
      `Bearer ${token({ aud: "brenraphaels-stock" })}`, `Bearer ${token({ scope: "stock:read" })}`, `Bearer ${token({ iss: "creoms" })}`]) {
      expect((await post(body, authorization)).status, String(authorization)).toBe(401);
    }
    vi.stubEnv("IMS_CREOMS_SECRET", "short");
    expect((await post(body)).status).toBe(401);
    expect(applied.calls).toEqual([]);
  });

  it("refuses malformed figures", async () => {
    for (const bad of [{ ...body, productId: 0 }, { ...body, quantity: -1 }, { ...body, version: 5 }, { ...body, available: 1.5 }, {}]) {
      expect((await post(bad)).status).toBe(400);
    }
  });

  it("answers 503 when the count cannot be saved, so the IMS tries again", async () => {
    applied.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post(body)).status).toBe(503);
  });

  it("removes a deleted IMS Size on DELETE and refuses invalid auth or product ids", async () => {
    const del = (query: string, authorization: string | null = `Bearer ${token()}`) =>
      DELETE(new NextRequest(`https://creoms.test/api/internal/ims-stock${query}`, {
        method: "DELETE", headers: authorization ? { Authorization: authorization } : {},
      }));

    const ok = await del("?productId=36");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ deleted: true });
    expect(applied.deleted).toEqual([36]);

    expect((await del("?productId=36", null)).status).toBe(401);
    expect((await del("?productId=0")).status).toBe(400);
    expect((await del("")).status).toBe(400);

    applied.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await del("?productId=36")).status).toBe(503);
  });
});
