import { afterEach, expect, it, vi } from "vitest";

import { readProductFeed, readProductStock, readStock } from "@/lib/storefront";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function configure(fetcher: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  vi.stubEnv("CREOMS_STOREFRONT_URL", "https://storefront.test");
  vi.stubEnv("CREOMS_SERVICE_SECRET", "s".repeat(40));
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => fetcher(new URL(url), init)));
}

it("asks the storefront for IMS stock with a stock-read credential, once per page open", async () => {
  let scope = "";
  configure((url, init) => {
    const token = String((init.headers as Record<string, string>).Authorization).replace("Bearer ", "");
    scope = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).scope;
    expect(url.pathname).toBe("/api/internal/stock");
    expect(url.searchParams.get("sizeIds")).toBe("1,2");
    return Response.json({ sizes: [{ sizeId: 1, quantity: 5, reserved: 1, available: 4 }, { sizeId: 2, quantity: null, reserved: null, available: null }] });
  });
  const stock = await readStock([1, 2]);
  expect(scope).toBe("stock:read");
  expect(stock?.get(1)).toEqual({ sizeId: 1, quantity: 5, reserved: 1, available: 4 });
  expect(stock?.get(2)?.available).toBeNull();
});

it("returns null when the storefront refuses or cannot be reached, or is not configured", async () => {
  configure(() => new Response("no", { status: 503 }));
  expect(await readStock([1])).toBeNull();
  configure(() => { throw new Error("offline"); });
  expect(await readStock([1])).toBeNull();
  vi.unstubAllEnvs();
  expect(await readStock([1])).toBeNull();
});

it("reads the IMS product feed from the storefront, keeping valid items and normalising blanks", async () => {
  let path = "";
  configure((url) => {
    path = url.pathname;
    return Response.json({ products: [
      { productId: 4, name: " Toffee Jam ", variant: " ", image: "", price: 150, active: true },
      { productId: "x", name: "Bad" },
      { productId: 7, name: "Old", variant: "250g", image: "i.png", price: 0, active: false },
    ] });
  });
  expect(await readProductFeed()).toEqual([
    { productId: 4, name: "Toffee Jam", variant: null, image: null, price: 150, active: true },
    { productId: 7, name: "Old", variant: "250g", image: "i.png", price: null, active: false },
  ]);
  expect(path).toBe("/api/internal/products");
});

it("returns null for the feed when the storefront has no such route, sends a bad body, times out or is not configured", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  configure(() => new Response("missing", { status: 404 }));
  expect(await readProductFeed()).toBeNull();
  configure(() => Response.json({ products: "nope" }));
  expect(await readProductFeed()).toBeNull();
  configure(() => { throw new Error("timeout"); });
  expect(await readProductFeed()).toBeNull();
  expect(quiet).toHaveBeenCalledTimes(3);
  quiet.mockRestore();
  vi.unstubAllEnvs();
  expect(await readProductFeed()).toBeNull();
});

it("reads stock by IMS product id for the Stock page, keyed by that id", async () => {
  configure((url) => {
    expect(url.searchParams.get("productIds")).toBe("55,56");
    expect(url.searchParams.has("sizeIds")).toBe(false);
    return Response.json({ products: [{ productId: 55, quantity: 67, reserved: 0, available: 67 }, { productId: 56, quantity: null, reserved: null, available: null }] });
  });
  const stock = await readProductStock([55, 56]);
  expect(stock?.get(55)).toEqual({ sizeId: 55, quantity: 67, reserved: 0, available: 67 });
  expect(stock?.get(56)?.available).toBeNull();
});
