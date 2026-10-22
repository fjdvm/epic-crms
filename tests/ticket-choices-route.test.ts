import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireModule: vi.fn(),
  searchCustomers: vi.fn(),
  customerOrders: vi.fn(),
  ticketsDatabase: vi.fn(() => "reader"),
}));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: mocks.ticketsDatabase }));
vi.mock("@/features/tickets/new-ticket", () => ({ searchCustomers: mocks.searchCustomers, customerOrders: mocks.customerOrders }));

import { GET } from "@/app/api/tickets/choices/route";

beforeEach(() => { vi.resetAllMocks(); });

describe("Ticket choice reads", () => {
  it("requires the Tickets Module before accessing any data", async () => {
    mocks.requireModule.mockRejectedValue(new Error("denied"));
    await expect(GET(new Request("http://localhost/api/tickets/choices?q=mark"))).rejects.toThrow("denied");
    expect(mocks.requireModule).toHaveBeenCalledWith("Tickets");
    expect(mocks.ticketsDatabase).not.toHaveBeenCalled();
  });

  it("searches Customers and prevents shared response caching", async () => {
    mocks.searchCustomers.mockResolvedValue([{ id: "c2", name: "Mark", email: "mark@example.com" }]);
    const response = await GET(new Request("http://localhost/api/tickets/choices?q=mark"));
    expect(mocks.searchCustomers).toHaveBeenCalledWith("reader", "mark");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toHaveLength(1);
  });

  it("reads Orders for the selected Customer", async () => {
    mocks.customerOrders.mockResolvedValue([]);
    const response = await GET(new Request("http://localhost/api/tickets/choices?customerId=c2"));
    expect(mocks.customerOrders).toHaveBeenCalledWith("reader", "c2");
    expect(await response.json()).toEqual([]);
    expect(mocks.searchCustomers).not.toHaveBeenCalled();
  });

  it("returns a retryable failure instead of caching a database outage as no results", async () => {
    mocks.searchCustomers.mockRejectedValue(new Error("database unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(new Request("http://localhost/api/tickets/choices?q=mark"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    error.mockRestore();
  });
});
