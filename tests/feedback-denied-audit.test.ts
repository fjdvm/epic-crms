import { beforeEach, describe, expect, it, vi } from "vitest";

// Refused and failed Feedback attempts (#750), at the action boundary. The events are read from the injected AuditTrail.
const mocks = vi.hoisted(() => ({
  audit: vi.fn(async (_event: import("@/lib/audit-trail").AuditEvent) => {}),
  requireModule: vi.fn(),
  runAnalysis: vi.fn(),
  openProductAdvice: vi.fn(),
}));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: mocks.audit }));
vi.mock("@/lib/feedback-db", () => ({ feedbackWriterDatabase: () => "writer" }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => "tickets" }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => "crms" }));
vi.mock("@/features/feedback/analysis", () => ({ runAnalysis: mocks.runAnalysis }));
vi.mock("@/features/feedback/product-advice", () => ({ openProductAdvice: mocks.openProductAdvice }));
vi.mock("@/features/feedback/sentiment-clients", () => ({ configuredClients: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { analyze, generateProductAdvice } from "@/features/feedback/actions";

const staff = { id: "portal-1", username: "ana", name: "Ana", role: "Staff" };
const admin = { id: "portal-9", username: "ada", name: "Ada", role: "Admin" };
const events = () => mocks.audit.mock.calls.map(([e]) => e);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModule.mockResolvedValue(staff);
});

describe("Analyze attempts", () => {
  it("records a view-only Role's attempt once per replay, and runs nothing", async () => {
    mocks.requireModule.mockResolvedValue(admin);
    expect(await analyze()).toEqual({ status: "read-only" });
    await analyze();
    const [first, second] = events();
    expect(first).toMatchObject({ module: "Feedback", action: "feedback.analysis_run", outcome: "failure", actor: { id: "portal-9", display_name: "Ada" }, metadata: { reason: "read-only" } });
    expect(first.operationId).toBe(second.operationId);
    expect(mocks.runAnalysis).not.toHaveBeenCalled();
  });

  it.each(["no-keys", "busy"] as const)("records a run that could not start (%s)", async (status) => {
    mocks.runAnalysis.mockResolvedValue({ status });
    await analyze();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ action: "feedback.analysis_run", outcome: "failure", metadata: { reason: status } });
  });

  it("records a cooldown with its end, so the same cooldown is one event", async () => {
    mocks.runAnalysis.mockResolvedValue({ status: "cooling-down", until: new Date("2026-11-25T10:00:00Z") });
    await analyze();
    await analyze();
    const [first, second] = events();
    expect(first.metadata).toEqual({ until: "2026-11-25T10:00:00.000Z", reason: "cooling-down" });
    expect(first.operationId).toBe(second.operationId);
  });

  it("records a run that threw, and records nothing for a finished run or nothing to do", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runAnalysis.mockRejectedValue(new Error("boom"));
    expect(await analyze()).toEqual({ status: "unavailable" });
    expect(events()[0]).toMatchObject({ outcome: "failure", metadata: { reason: "unavailable" } });
    mocks.audit.mockClear();
    mocks.runAnalysis.mockResolvedValue({ status: "nothing-to-do" });
    await analyze();
    mocks.runAnalysis.mockResolvedValue({ status: "done", analyzed: 1, failed: 0, model: null, topProduct: null });
    await analyze();
    expect(events()).toEqual([]);
  });
});

describe("product suggestion attempts", () => {
  it("records a view-only Role's attempt and never asks the model", async () => {
    mocks.requireModule.mockResolvedValue(admin);
    await generateProductAdvice();
    expect(events()[0]).toMatchObject({ action: "feedback.product_advice", outcome: "failure", metadata: { reason: "read-only" } });
    expect(mocks.openProductAdvice).not.toHaveBeenCalled();
  });

  it("records a request that produced nothing, and keeps the success event for a result", async () => {
    mocks.openProductAdvice.mockResolvedValue({ result: null, unavailable: true });
    await generateProductAdvice();
    expect(events()[0]).toMatchObject({ action: "feedback.product_advice", outcome: "failure", metadata: { reason: "unavailable" } });
    mocks.audit.mockClear();
    mocks.openProductAdvice.mockResolvedValue({ result: { createdAt: "2026-11-25T01:00:00Z", model: "m", adviceUnavailable: false, products: [] }, unavailable: false });
    await generateProductAdvice();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ action: "feedback.product_advice", outcome: "success" });
  });
});
