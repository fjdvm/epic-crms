import { describe, expect, it } from "vitest";

import { formatPhilippineTime, parsePhilippineTime, toPhilippineInput } from "@/features/marketing/philippine-time";

describe("Philippine Time", () => {
  it("reads a typed date and time as UTC+8, whatever the browser's zone", () => {
    expect(parsePhilippineTime("2026-10-25T09:30")?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(parsePhilippineTime("2026-10-25T00:15")?.toISOString()).toBe("2026-10-24T16:15:00.000Z");
  });

  it("refuses what is not a real date and time", () => {
    for (const bad of ["", "tomorrow", "2026-10-25", "2026-02-31T09:00", "2026-10-25T24:30", "2026-13-01T09:00"]) {
      expect(parsePhilippineTime(bad), bad).toBeNull();
    }
  });

  it("shows a moment as the date and time on a Philippine clock", () => {
    const moment = new Date("2026-10-25T01:30:00Z");

    expect(formatPhilippineTime(moment)).toBe("25 Oct 2026, 9:30 am");
    expect(formatPhilippineTime(new Date("2026-10-25T10:05:00Z"))).toBe("25 Oct 2026, 6:05 pm");
    expect(toPhilippineInput(moment)).toBe("2026-10-25T09:30");
  });
});
