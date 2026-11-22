import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireModule } = vi.hoisted(() => ({ requireModule: vi.fn() }));
vi.mock("@/lib/portal/staff", () => ({ requireModule }));
import { POST } from "@/app/api/tickets/summary/route";

const request = (body: unknown, headers: Record<string, string> = { "x-creoms-ticket-open": "1" }) =>
  new Request("http://localhost/api/tickets/summary", { method: "POST", headers, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); });

describe("Ticket summary request security", () => {
  it("rejects cross-site or form requests before any Ticket or model work", async () => {
    expect((await POST(request({ ticketId: 1 }, {}))).status).toBe(403);
    expect((await POST(request({ ticketId: 1 }, { "x-creoms-ticket-open": "1", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(requireModule).not.toHaveBeenCalled();
  });
  it("requires the Tickets Module on each open", async () => {
    requireModule.mockRejectedValue(new Error("denied"));
    await expect(POST(request({ ticketId: 1 }))).rejects.toThrow("denied");
    expect(requireModule).toHaveBeenCalledWith("Tickets");
  });
  it("rejects invalid Ticket ids without model work and prevents shared caching", async () => {
    requireModule.mockResolvedValue({ role: "Staff" });
    for (const ticketId of [0, -1, 1.2, "1", null, 1_000_000_000]) {
      const response = await POST(request({ ticketId }));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});
