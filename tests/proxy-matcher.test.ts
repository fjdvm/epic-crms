import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

const matches = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe("proxy matcher", () => {
  it("leaves the health route outside the Portal session", () => {
    expect(matches("/api/health")).toBe(false);
  });

  it("still guards the other approval routes", () => {
    expect(matches("/api/approvals/requests")).toBe(true);
  });

  it("still guards pages", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/customers")).toBe(true);
  });
});
