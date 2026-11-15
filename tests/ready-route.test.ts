import { beforeEach, describe, expect, it, vi } from "vitest";

const reader = vi.fn();
const writer = vi.fn();

vi.mock("@/lib/db", () => ({ database: () => reader }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => writer }));

const { GET } = await import("@/app/api/ready/route");

beforeEach(() => {
  reader.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  writer.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readiness route", () => {
  it("answers 200 when both databases answer", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("answers 503, without the reason, when the shared database is unreachable", async () => {
    reader.mockRejectedValue(new Error("connect ECONNREFUSED secret-host"));
    const response = await GET();

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
  });

  it("answers 503 when the crms schema database is unreachable", async () => {
    writer.mockRejectedValue(new Error("down"));

    expect((await GET()).status).toBe(503);
  });

  it("answers 503 when a database is not configured", async () => {
    reader.mockImplementation(() => { throw new Error("CREOMS_DATABASE_URL is not set"); });

    expect((await GET()).status).toBe(503);
  });
});
