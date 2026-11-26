import { beforeEach, describe, expect, it, vi } from "vitest";

// Dashboard and AI insights PDF exports (#752), at the route boundary. Events are read from the injected AuditTrail.
const mocks = vi.hoisted(() => ({
  audit: vi.fn(async (_event: import("@/lib/audit-trail").AuditEvent) => {}),
  requireModule: vi.fn(), heldModules: vi.fn(), figures: vi.fn(), dashboardPdf: vi.fn(),
  loadLatestRun: vi.fn(), insightsPdf: vi.fn(), canSee: vi.fn(),
}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: mocks.audit }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule, heldModules: mocks.heldModules, canSeeAiInsights: mocks.canSee }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => "tickets" }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => "crms" }));
vi.mock("@/features/tickets/service-level-store", () => ({ readServiceLevels: async () => null }));
vi.mock("@/features/settings/automatic-checks-server", () => ({ currentUnconfirmedHours: async () => 48, currentPaymentReviewHours: async () => 48 }));
vi.mock("@/features/dashboard/figures", () => ({ loadDashboardFigures: mocks.figures }));
vi.mock("@/features/dashboard/pdf", () => ({ dashboardPdf: mocks.dashboardPdf }));
vi.mock("@/features/ai-insights/run", () => ({ loadLatestRun: mocks.loadLatestRun }));
vi.mock("@/features/ai-insights/pdf", () => ({ insightsPdf: mocks.insightsPdf }));
vi.mock("@/features/ai-insights/store", () => ({
  parseDays: (v: string | null) => (v === "30" ? 30 : v === "7" ? 7 : null),
  viewerState: async () => ({ dismissed: [] }), visibleInsights: () => [],
}));
vi.mock("@/features/ai-insights/view-model", () => ({ visibleStats: () => [] }));

import { GET as dashboardPdf } from "@/app/api/dashboard/pdf/route";
import { GET as insightsPdf } from "@/app/api/dashboard/ai-insights/pdf/route";

const staff = { id: "portal-1", name: "Ana", role: "Staff/Employee" };
const events = () => mocks.audit.mock.calls.map(([e]) => e);
const dash = (period = "today") => new Request(`http://localhost/api/dashboard/pdf?period=${period}`);
const insights = (days = "7") => new Request(`http://localhost/api/dashboard/ai-insights/pdf?days=${days}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.requireModule.mockResolvedValue(staff);
  mocks.heldModules.mockResolvedValue([]);
  mocks.figures.mockResolvedValue({});
  mocks.dashboardPdf.mockResolvedValue(Buffer.from("%PDF-"));
  mocks.canSee.mockReturnValue(true);
  mocks.loadLatestRun.mockResolvedValue({ id: 5, insights: [], stats: [] });
  mocks.insightsPdf.mockResolvedValue(Buffer.from("%PDF-"));
});

describe("Dashboard PDF export", () => {
  it("records one success event with the period and no figures, once per replay", async () => {
    expect((await dashboardPdf(dash("30-days"))).status).toBe(200);
    await dashboardPdf(dash("30-days"));
    const [first, second] = events();
    expect(first).toMatchObject({
      module: "Dashboard", action: "dashboard.pdf_exported", outcome: "success",
      actor: { id: "portal-1", display_name: "Ana" }, target: { type: "dashboard-export", id: "7-days" }, metadata: { choice: "7-days" },
    });
    expect(first.operationId).toBe(second.operationId);
  });

  it("records a failure when the PDF could not be made, and returns an error", async () => {
    mocks.dashboardPdf.mockRejectedValue(new Error("boom"));
    const response = await dashboardPdf(dash("today"));
    expect(response.status).toBe(500);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ action: "dashboard.pdf_exported", outcome: "failure", metadata: { choice: "today", reason: "unavailable" } });
  });

  it("records nothing extra when access is refused (the guard audits that)", async () => {
    mocks.requireModule.mockRejectedValue(new Error("denied"));
    await expect(dashboardPdf(dash())).rejects.toThrow("denied");
    expect(events()).toEqual([]);
  });
});

describe("AI insights PDF export", () => {
  it("records one success event with the days window", async () => {
    expect((await insightsPdf(insights("30"))).status).toBe(200);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ module: "Dashboard", action: "dashboard.ai_insights_pdf_exported", outcome: "success", target: { id: "30-days" }, metadata: { choice: "30-days" } });
  });

  it("adds Top products only for people who hold Orders, and the rating only with Feedback", async () => {
    mocks.heldModules.mockResolvedValue(["Orders"]);
    await insightsPdf(insights());
    expect(mocks.insightsPdf.mock.calls[0][4]).toEqual({ products: true, ratings: false });
    mocks.heldModules.mockResolvedValue(["Orders", "Feedback"]);
    await insightsPdf(insights());
    expect(mocks.insightsPdf.mock.calls[1][4]).toEqual({ products: true, ratings: true });
  });

  it("records the denied attempt of a Role that cannot open AI insights, and reads nothing", async () => {
    mocks.canSee.mockReturnValue(false);
    expect((await insightsPdf(insights())).status).toBe(403);
    await insightsPdf(insights());
    const [first, second] = events();
    expect(first).toMatchObject({ action: "dashboard.ai_insights_pdf_exported", outcome: "failure", metadata: { reason: "role-not-allowed" } });
    expect(first.operationId).toBe(second.operationId);
    expect(mocks.loadLatestRun).not.toHaveBeenCalled();
  });

  it("records a request with no stored run, and one that threw", async () => {
    mocks.loadLatestRun.mockResolvedValue(null);
    expect((await insightsPdf(insights())).status).toBe(404);
    expect(events()[0]).toMatchObject({ outcome: "failure", metadata: { reason: "no-run" } });
    mocks.audit.mockClear();
    mocks.loadLatestRun.mockRejectedValue(new Error("db"));
    expect((await insightsPdf(insights())).status).toBe(500);
    expect(events()[0]).toMatchObject({ outcome: "failure", metadata: { reason: "unavailable" } });
  });
});
