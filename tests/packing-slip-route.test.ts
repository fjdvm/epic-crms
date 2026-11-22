import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const mocks = vi.hoisted(() => ({ loadPackingSlip: vi.fn() }));
vi.mock("@/features/orders/actions", () => ({ loadPackingSlip: mocks.loadPackingSlip }));

import { GET } from "@/app/api/orders/[id]/packing-slip/route";

const slip = {
  id: 1042, createdAt: new Date("2026-10-20T00:00:00Z"), customer: { id: "c1", name: "Maria Santos" },
  fulfillmentMethod: "delivery", lines: [{ product: "Ube Halaya", size: "500g", quantity: 2, price: 50_000 }],
  address: { street: "1 Mabini St", barangay: "Poblacion", city: "Makati", province: "Metro Manila", postalCode: "1200", country: "Philippines" },
  packedBy: { id: "u1", name: "Liza B.", at: new Date("2026-10-21T01:00:00Z") },
};
const call = (id: string) => GET(new Request(`http://localhost/api/orders/${id}/packing-slip`), { params: Promise.resolve({ id }) });

async function text(response: Response) {
  const data = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(data.slice(0, 5))).toBe("%PDF-");
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, i) => {
    const content = await (await pdf.getPage(i + 1)).getTextContent();
    return content.items.map((item) => "str" in item ? item.str : "").join(" ");
  }));
  return pages.join(" ");
}

beforeEach(() => vi.resetAllMocks());

describe("Packing slip PDF", () => {
  it("returns a branded inline PDF with the items and no payment data", async () => {
    mocks.loadPackingSlip.mockResolvedValue({ ok: true, slip });
    const response = await call("1042");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="packing-slip-order-1042.pdf"');
    const body = await text(response);
    for (const expected of ["Bren Raphael's", "Bren Raphael's Ube Jam & Halaya · Generated", "Packing slip", "Order #1042", "Maria Santos", "Ube Halaya", "500g", "Packed by Liza B.", "Page 1 of 1"]) {
      expect(body).toContain(expected);
    }
    expect(body).not.toMatch(/GCash|reference|proof/i);
  });

  it.each([
    ["Invalid Order number.", 400], ["Order was not found.", 404], ["Packing slip is temporarily unavailable.", 503],
  ])("refuses with %s and no PDF", async (reason, status) => {
    mocks.loadPackingSlip.mockResolvedValue({ ok: false, reason });
    const response = await call("1042");
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ reason });
  });

  it("does not make a PDF when the Module gate throws", async () => {
    mocks.loadPackingSlip.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(call("1042")).rejects.toThrow("NEXT_REDIRECT");
  });
});
