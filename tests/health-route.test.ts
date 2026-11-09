import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("answers 200 with no database, secrets or session configured", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
