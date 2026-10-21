import { beforeEach, describe, expect, it, vi } from "vitest";

const runAnalysis = vi.fn();

vi.mock("@/features/feedback/analysis", () => ({ runAnalysis }));
vi.mock("@/features/feedback/sentiment-clients", () => ({ configuredClients: () => ({ grok: null, gemini: null }) }));
vi.mock("@/lib/feedback-db", () => ({ feedbackWriterDatabase: () => ({}) }));
vi.mock("@/lib/gateway", () => ({ writeAuditEvent: vi.fn() }));

const { GET } = await import("@/app/api/cron/feedback-analysis/route");

const call = (authorization?: string) =>
  GET(new Request("http://localhost/api/cron/feedback-analysis", { headers: authorization ? { authorization } : {} }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
});

describe("the scheduled Feedback analysis route", () => {
  it("rejects a caller without the cron credential, and runs nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("rejects everyone when no cron secret is configured", async () => {
    delete process.env.CRON_SECRET;

    expect((await call("Bearer undefined")).status).toBe(401);
  });

  it("runs the analysis as the schedule and returns the result", async () => {
    runAnalysis.mockResolvedValue({ status: "done", analyzed: 2, failed: 0, model: "grok-4" });

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "done", analyzed: 2, failed: 0, model: "grok-4" });
    expect(runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ actor: { kind: "schedule" } }));
  });

  it("answers 500 when the run throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runAnalysis.mockRejectedValue(new Error("database down"));

    expect((await call("Bearer cron-secret")).status).toBe(500);
  });
});
