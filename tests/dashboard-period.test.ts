import { describe, expect, it } from "vitest";

import { PERIOD_PRESETS, resolvePeriod } from "@/features/dashboard/period";

// 2026-10-25 15:00 in Philippine Time.
const now = new Date("2026-10-25T07:00:00Z");

const iso = (p: { start: Date; end: Date }) => [p.start.toISOString(), p.end.toISOString()];

describe("Dashboard periods", () => {
  it("offers the five presets", () => {
    expect(PERIOD_PRESETS).toEqual(["today", "7-days", "this-month", "last-month", "90-days"]);
  });

  it("runs Today from Philippine midnight to the next one, previous is yesterday", () => {
    const p = resolvePeriod("today", now);

    expect(iso(p)).toEqual(["2026-10-24T16:00:00.000Z", "2026-10-25T16:00:00.000Z"]);
    expect(iso(p.previous)).toEqual(["2026-10-23T16:00:00.000Z", "2026-10-24T16:00:00.000Z"]);
  });

  it("uses the Philippine date even when UTC is still the day before", () => {
    // 2026-10-24 17:00Z is already 25 Oct 01:00 in Manila.
    const p = resolvePeriod("today", new Date("2026-10-24T17:00:00Z"));

    expect(p.start.toISOString()).toBe("2026-10-24T16:00:00.000Z");
  });

  it("covers 7 days including today", () => {
    const p = resolvePeriod("7-days", now);

    expect(iso(p)).toEqual(["2026-10-18T16:00:00.000Z", "2026-10-25T16:00:00.000Z"]);
    expect(iso(p.previous)).toEqual(["2026-10-11T16:00:00.000Z", "2026-10-18T16:00:00.000Z"]);
  });

  it("covers 90 days including today", () => {
    const p = resolvePeriod("90-days", now);

    expect(p.end.getTime() - p.start.getTime()).toBe(90 * 86_400_000);
    expect(p.previous.end).toEqual(p.start);
    expect(p.start.toISOString()).toBe("2026-07-27T16:00:00.000Z");
  });

  it("runs This month from the 1st to the end of today, with an equal-length previous", () => {
    const p = resolvePeriod("this-month", now);

    expect(iso(p)).toEqual(["2026-09-30T16:00:00.000Z", "2026-10-25T16:00:00.000Z"]);
    expect(p.previous.end).toEqual(p.start);
    expect(p.previous.end.getTime() - p.previous.start.getTime()).toBe(p.end.getTime() - p.start.getTime());
  });

  it("runs Last month over the whole of the month before", () => {
    const p = resolvePeriod("last-month", now);

    expect(iso(p)).toEqual(["2026-08-31T16:00:00.000Z", "2026-09-30T16:00:00.000Z"]);
    expect(p.previous.end).toEqual(p.start);
    expect(p.previous.end.getTime() - p.previous.start.getTime()).toBe(30 * 86_400_000);
  });

  it("rolls Last month back over a year end", () => {
    const p = resolvePeriod("last-month", new Date("2027-01-10T00:00:00Z"));

    expect(iso(p)).toEqual(["2026-11-30T16:00:00.000Z", "2026-12-31T16:00:00.000Z"]);
  });
});
