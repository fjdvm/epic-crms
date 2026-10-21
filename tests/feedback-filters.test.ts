import { describe, expect, it } from "vitest";

import { feedbackHref, manilaToday, parseFilters, quickRange } from "@/features/feedback/filters";

describe("parseFilters", () => {
  it("defaults to All time, every rating, page 1", () => {
    expect(parseFilters({})).toEqual({ from: undefined, to: undefined, stars: undefined, page: 1 });
  });

  it("reads the range, stars and page from the address", () => {
    expect(parseFilters({ from: "2026-10-01", to: "2026-10-31", stars: "2", page: "3" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      stars: 2,
      page: 3,
    });
  });

  it("ignores values that are not real dates, ratings or pages", () => {
    expect(parseFilters({ from: "2026-02-30", to: "yesterday", stars: "9", page: "-1" })).toEqual({
      from: undefined,
      to: undefined,
      stars: undefined,
      page: 1,
    });
  });

  it("reads the product from the address and ignores a blank one", () => {
    expect(parseFilters({ product: "Smooth tub" }).product).toBe("Smooth tub");
    expect(parseFilters({ product: "  " }).product).toBeUndefined();
  });

  it("swaps a range given backwards", () => {
    expect(parseFilters({ from: "2026-10-31", to: "2026-10-01" })).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("feedbackHref", () => {
  it("is the bare page for the defaults", () => {
    expect(feedbackHref({ page: 1 })).toBe("/feedback");
  });

  it("keeps the range, stars and page", () => {
    expect(feedbackHref({ from: "2026-10-01", to: "2026-10-31", stars: 2, page: 2 })).toBe(
      "/feedback?from=2026-10-01&to=2026-10-31&stars=2&page=2",
    );
  });
});

describe("feedbackHref with a product", () => {
  it("keeps the product, encoded, with the other filters", () => {
    expect(feedbackHref({ product: "Smooth tub & more", stars: 2, page: 1 })).toBe(
      "/feedback?stars=2&product=Smooth+tub+%26+more",
    );
  });
});

describe("manilaToday", () => {
  it("is the date in the Philippines, which is ahead of UTC by 8 hours", () => {
    expect(manilaToday(new Date("2026-10-20T15:59:00Z"))).toBe("2026-10-20");
    expect(manilaToday(new Date("2026-10-20T16:00:00Z"))).toBe("2026-10-21");
  });
});

describe("quickRange", () => {
  const today = "2026-03-02";

  it("Last 7 days ends today and includes it", () => {
    expect(quickRange("7d", today)).toEqual({ from: "2026-02-24", to: "2026-03-02" });
  });

  it("Last 30 days ends today and includes it", () => {
    expect(quickRange("30d", today)).toEqual({ from: "2026-02-01", to: "2026-03-02" });
  });

  it("This year runs from 1 January to today", () => {
    expect(quickRange("year", today)).toEqual({ from: "2026-01-01", to: "2026-03-02" });
  });
});
