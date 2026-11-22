import { describe, expect, it } from "vitest";

import { DEFAULT_AUTOMATIC_CHECKS } from "@/features/settings/automatic-checks";
import { toCentavos, toHours, toWhole, pesosToCentavos } from "@/features/management/settings-format";

describe("settings format", () => {
  it("reads pesos, hours and counts, and refuses anything else", () => {
    expect(toCentavos("5,000.50")).toBe(500050);
    expect(toCentavos("abc")).toBeNull();
    expect(toHours("8760")).toBe(8760);
    expect(toHours("0")).toBeNull();
    expect(toWhole("1001", 1000)).toBeNull();
    expect(pesosToCentavos("0")).toBe(0);
  });

  it("keeps the defaults intact when nothing is edited", async () => {
    const { buildChecks } = await import("@/features/management/automatic-checks-form");
    const text = { "returns.count": "3", "returns.days": "90", "unverified.count": "5", "unverified.waitHours": "24", "spike.count": "3", "spike.days": "7", "failed.count": "3", "unconfirmed.hours": "48", "reviews.hours": "48" };
    expect(buildChecks({ checks: DEFAULT_AUTOMATIC_CHECKS, amount: "1500", text })).toEqual(DEFAULT_AUTOMATIC_CHECKS);
    expect(buildChecks({ checks: DEFAULT_AUTOMATIC_CHECKS, amount: "1500", text: { ...text, "returns.days": "0" } })).toBeNull();
  });
});
