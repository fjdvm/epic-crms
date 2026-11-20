import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readProductFeed } from "@/lib/storefront";

beforeEach(() => {
  vi.stubEnv("CREOMS_STOREFRONT_URL", "https://shop.example");
  vi.stubEnv("CREOMS_SERVICE_SECRET", "s".repeat(32));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const answer = (body: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));

it("reads every Size, turning a blank Variant, image or price into nothing", async () => {
  answer({ products: [
    { productId: 1, name: " Ube Jam ", variant: "250g", image: "a.png", price: 120.5, active: true },
    { productId: 2, name: "Ube Powder", variant: " ", image: null, price: 0, active: false },
    { name: "no id" },
  ] });
  expect(await readProductFeed()).toEqual([
    { productId: 1, name: "Ube Jam", variant: "250g", image: "a.png", price: 120.5, active: true },
    { productId: 2, name: "Ube Powder", variant: null, image: null, price: null, active: false },
  ]);
});

it("returns null when the feed is refused, malformed, unreachable or not configured", async () => {
  answer({}, false);
  expect(await readProductFeed()).toBeNull();
  answer({ products: "x" });
  expect(await readProductFeed()).toBeNull();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
  expect(await readProductFeed()).toBeNull();
  vi.stubEnv("CREOMS_SERVICE_SECRET", "");
  expect(await readProductFeed()).toBeNull();
});
