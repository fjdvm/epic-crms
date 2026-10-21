import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gatewayImageStore } from "@/lib/gateway";

const calls: { url: string; method: string; body?: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  process.env.CREOMS_GATEWAY_URL = "https://gateway.test";
  process.env.CREOMS_GATEWAY_CALLER_KEY = "key";
});

afterEach(() => vi.unstubAllGlobals());

function stubGateway(viewed: { url: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });

      if (method === "POST" && url === "https://gateway.test/files")
        return Response.json({ id: "f1", uploadUrl: "https://bucket.test/put" });
      if (method === "PUT") return new Response(null, { status: 200 });
      if (url.endsWith("/confirm")) return Response.json({});

      return Response.json(viewed);
    }),
  );
}

describe("the gateway image store", () => {
  it("keeps the image as a Public, Permanent File and returns its public address", async () => {
    stubGateway({ url: "https://cdn.test/f1.jpg" });

    const url = await gatewayImageStore.store({ contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) });

    expect(url).toBe("https://cdn.test/f1.jpg");
    expect(calls[0].body).toMatchObject({ contentType: "image/jpeg", size: 3, visibility: "public", retentionType: "permanent" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "POST", "GET"]);
  });

  it("refuses an address that is not HTTPS, so an email never shows a broken image", async () => {
    stubGateway({ url: "http://cdn.test/f1.jpg" });

    await expect(gatewayImageStore.store({ contentType: "image/jpeg", bytes: new Uint8Array([1]) })).rejects.toThrow(/HTTPS/);
  });
});
