import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { DashboardFigures } from "@/features/dashboard/figures";
import { resolvePeriod } from "@/features/dashboard/period";

const mocks = vi.hoisted(() => ({
  requireModule: vi.fn(), heldModules: vi.fn(), figures: vi.fn(),
  database: vi.fn(() => "reader"),
}));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule, heldModules: mocks.heldModules }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: mocks.database }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => "crms" }));
vi.mock("@/features/tickets/service-level-store", () => ({ readServiceLevels: async () => ({ history: [] }) }));
vi.mock("@/features/settings/automatic-checks-server", () => ({ currentUnconfirmedHours: async () => 48, currentPaymentReviewHours: async () => 48 }));
vi.mock("@/features/dashboard/figures", () => ({ loadDashboardFigures: mocks.figures }));

import { GET } from "@/app/api/dashboard/pdf/route";

const now = new Date("2026-10-24T17:30:00Z"); // October 25, 01:30 in Philippine Time.
const request = (period = "today") => new Request(`http://localhost/api/dashboard/pdf?period=${period}`);

async function readPdf(response: Response) {
  const data = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(data.slice(0, 5))).toBe("%PDF-");
  const task = getDocument({ data, useSystemFonts: true });
  const pdf = await task.promise;
  try {
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items.map((item) => "str" in item ? item.str : "").join(" ");
    }));
    return pages.join(" ");
  } finally {
    await task.destroy();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.requireModule.mockResolvedValue({ role: "Staff/Employee" });
  mocks.heldModules.mockResolvedValue(["Payments"]);
  mocks.figures.mockResolvedValue({ sales: { ok: true, current: 123456, previous: 100000 } });
});
afterEach(() => vi.useRealTimers());

describe("Dashboard PDF export", () => {
  it("downloads a PDF with the shared figures, chosen Philippine period and generation time", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="dashboard-today-2026-10-25.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.figures).toHaveBeenCalledWith(mocks.database, {
      period: resolvePeriod("today", now), modules: ["Payments"], now, targets: [], unconfirmedHours: 48, reviewHours: 48, manager: false,
    });
    const text = await readPdf(response);
    expect(text).toContain("Dashboard");
    expect(text).toContain("Philippine Time (UTC+8)");
    expect(text).toContain("Oct 25, 2026");
    expect(text).toContain("01:30");
    expect(text).toContain("Sales");
    expect(text).toContain("₱1,235");
    expect(text).toContain("₱1,000");
  });

  it("includes permitted widgets and leaves out widgets absent from the figures", async () => {
    mocks.figures.mockResolvedValue({
      sales: { ok: true, current: 123456, previous: 100000 },
      averageOrder: { ok: true, current: 61728, previous: 50000 },
      attention: { paymentProofs: { ok: true, count: 3, oldest: new Date("2026-10-24T15:30:00Z") } },
    } satisfies DashboardFigures);
    const text = await readPdf(await GET(request("last-month")));
    expect(mocks.figures).toHaveBeenCalledWith(mocks.database, {
      period: resolvePeriod("last-month", now), modules: ["Payments"], now, targets: [], unconfirmedHours: 48, reviewHours: 48, manager: false,
    });
    expect(text).toContain("Sep 1, 2026 - Sep 30, 2026");
    expect(text).toContain("Average order");
    expect(text).toContain("₱617");
    expect(text).toContain("Payment proofs to check: 3");
    expect(text).not.toContain("Returning Buyers");
    expect(text).not.toContain("Customers by Stage");
    expect(text).not.toContain("Delivery fees to quote");
    expect(text).not.toContain("Open Tickets");
    expect(text).not.toContain("Average rating");
    expect(text).not.toContain("Best-selling products");
  });

  it("renders every figures kind, including zero and empty states", async () => {
    mocks.figures.mockResolvedValue({
      orders: { ok: true, current: 8, previous: 4 },
      averageRating: { ok: true, current: { average: null, count: 0 }, previous: { average: 4.5, count: 2 } },
      returningBuyers: { ok: true, current: { share: 0.25, buyers: 4 }, previous: { share: null, buyers: 0 } },
      monthlySales: { ok: true, months: [{ label: "2026-10", start: now, end: now, soFar: true, sales: 123456 }] },
      bestSellers: { ok: true, products: [{ productName: "Ube & Leche Flan", sales: 100000, units: 2, share: 0.8 }], remainder: { sales: 25000, share: 0.2 } },
      monthlyBuyers: { ok: true, months: [{ label: "2026-10", soFar: true, new: 3, returning: 1, share: 0.25 }] },
      paymentAndReceiving: { ok: true, payment: [{ method: "gcash", orders: 4, sales: 123456 }], receiving: [] },
      customersByStage: { ok: true, counts: { new: 1, "first-order": 2, repeat: 3, "at-risk": 4, lost: 5 } },
      atRisk: { ok: true, count: 4 }, newCustomers: { ok: true, current: 7, previous: 6 },
      unverifiedLeads: { ok: true, count: 9 },
      attention: {
        deliveryFees: { ok: true, count: 0, oldest: null },
        codToCollect: { ok: true, count: 2, oldest: null, centavos: 520000 },
        openTickets: { ok: true, count: 5, oldest: null, overdue: 2 },
        ordersToPack: { ok: true, count: 6, oldest: null },
        returns: { ok: true, count: 1, oldest: null }, lowFeedback: { ok: true, count: 3, oldest: null },
      },
    } satisfies DashboardFigures);
    const text = await readPdf(await GET(request()));
    for (const expected of [
      "Orders", "No Feedback yet", "4.5 stars - From 2 Feedback", "25% (4 Buyers)",
      "2026-10 (so far): ₱1,235", "Ube & Leche Flan: ₱1,000 - 2 units - 80% of Sales",
      "Other products and Delivery fees: ₱250 (20%)", "3 New / 1 Returning (25%)",
      "GCash: 4 Orders", "No Orders in this period", "Customers by Stage - As of today",
      "First order: 2", "4 At risk Customers", "New Customers", "9 Leads (separate from Customers)",
      "Delivery fees to quote: 0", "COD to collect: 2 - ₱5,200", "Open Tickets: 5 - 2 Overdue",
      "Orders to pack: 6", "Returns to decide: 1", "Low Feedback to review: 3",
    ]) expect(text).toContain(expected);
  });

  it("notes each failed widget and keeps the successful figures", async () => {
    mocks.figures.mockResolvedValue({
      sales: { ok: false }, orders: { ok: true, current: 42, previous: 30 },
      monthlySales: { ok: false }, bestSellers: { ok: false }, customersByStage: { ok: false },
      attention: { paymentProofs: { ok: false }, openTickets: { ok: true, count: 2, oldest: null, overdue: 1 } },
    } satisfies DashboardFigures);
    const text = await readPdf(await GET(request()));
    expect(text).toMatch(/Sales\s+Couldn't load/);
    expect(text).toMatch(/Sales - last six months\s+Couldn't load/);
    expect(text).toMatch(/Best-selling products\s+Couldn't load/);
    expect(text).toMatch(/Customers by Stage - As of today\s+Couldn't load/);
    expect(text).toContain("Payment proofs to check: Couldn't load");
    expect(text).toContain("42");
    expect(text).toContain("Open Tickets: 2 - 1 Overdue");
  });

  it("requires the Dashboard Module before reading Modules or figures", async () => {
    mocks.requireModule.mockRejectedValue(new Error("denied"));
    await expect(GET(request())).rejects.toThrow("denied");
    expect(mocks.requireModule).toHaveBeenCalledWith("Dashboard");
    expect(mocks.heldModules).not.toHaveBeenCalled();
    expect(mocks.figures).not.toHaveBeenCalled();
    expect(mocks.database).not.toHaveBeenCalled();
  });

  it.each(["7-days", "this-month", "90-days", "invalid", ""])("resolves %s like the page", async (value) => {
    await GET(request(value));
    const preset = value === "this-month" || value === "90-days" ? value : "7-days";
    expect(mocks.figures).toHaveBeenCalledWith(mocks.database, {
      period: resolvePeriod(preset, now), modules: ["Payments"], now, targets: [], unconfirmedHours: 48, reviewHours: 48, manager: false,
    });
  });

  it("exports an explanatory empty Dashboard when no data Modules are held", async () => {
    mocks.heldModules.mockResolvedValue([]);
    mocks.figures.mockResolvedValue({ attention: {} });
    const text = await readPdf(await GET(request()));
    expect(text).toContain("Your Modules do not include any data the Dashboard summarises.");
    expect(text).not.toContain("Sales");
    expect(text).not.toContain("Needs attention");
  });
});
