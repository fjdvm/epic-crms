import { afterEach, describe, expect, it, vi } from "vitest";
import { findCustomerOrders, findCustomers } from "@/features/tickets/ticket-choices-client";

afterEach(() => vi.unstubAllGlobals());

describe("independent Ticket lookups", () => {
  it("uses an abortable GET for search, preserving literal search characters", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await findCustomers("mark+5@example.com", controller.signal);
    expect(fetch).toHaveBeenCalledWith("/api/tickets/choices?q=mark%2B5%40example.com", {
      signal: controller.signal, cache: "no-store",
    });
  });

  it("fetches Orders without entering the mutation queue", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([{ id: 12 }]));
    vi.stubGlobal("fetch", fetch);
    expect(await findCustomerOrders("c2")).toEqual([{ id: 12 }]);
    expect(fetch).toHaveBeenCalledWith("/api/tickets/choices?customerId=c2", expect.objectContaining({ cache: "no-store" }));
  });

  it("rejects failed reads and sign-in pages so they cannot become cached results", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("sign in", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(findCustomers("mark")).rejects.toThrow("unavailable");
    await expect(findCustomers("mark")).rejects.toThrow("unavailable");
  });
});
