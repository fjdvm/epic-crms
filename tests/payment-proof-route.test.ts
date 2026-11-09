import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAnyModule: vi.fn(),
  viewUrl: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@/lib/portal/staff", () => ({ requireAnyModule: mocks.requireAnyModule }));
vi.mock("@/lib/gateway", () => ({ gatewayFileStorage: { viewUrl: mocks.viewUrl } }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => mocks.sql }));

import { GET } from "@/app/api/orders/[id]/payment-proof/route";

const context = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const request = new Request("http://localhost/api/orders/4/payment-proof");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAnyModule.mockResolvedValue({});
  mocks.sql.mockResolvedValue([{ payment_proof_file_id: "f1" }]);
  mocks.viewUrl.mockResolvedValue("https://files.test/f1?signature=short-lived");
});

describe("payment-proof screenshot route", () => {
  it("requires a Module that shows Payment proof before reading anything", async () => {
    mocks.requireAnyModule.mockRejectedValue(new Error("denied"));

    await expect(GET(request, context("4"))).rejects.toThrow("denied");
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("sends Staff to a short-lived address for the Order's File, never cached", async () => {
    const response = await GET(request, context("4"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://files.test/f1?signature=short-lived");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.viewUrl).toHaveBeenCalledWith("f1");
  });

  it("answers 404 for a bad id, an Order without a File, and a storage failure", async () => {
    expect((await GET(request, context("abc"))).status).toBe(404);

    mocks.sql.mockResolvedValueOnce([{ payment_proof_file_id: null }]);
    expect((await GET(request, context("4"))).status).toBe(404);

    mocks.viewUrl.mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await GET(request, context("4"))).status).toBe(404);
  });
});
