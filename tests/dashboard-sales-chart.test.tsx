// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SalesChart, SalesChartSkeleton } from "@/features/dashboard/sales-chart";
import { salesHeadline, soFarNote } from "@/features/dashboard/sales-headline";

afterEach(cleanup);

const months = (...sales: number[]) =>
  sales.map((amount, i) => ({
    label: `2026-${String(i + 5).padStart(2, "0")}`,
    sales: amount,
    soFar: i === sales.length - 1,
  }));

const pesos = (centavos: number) => `₱${(centavos / 100).toLocaleString("en-PH")}`;

describe("the Sales headline", () => {
  it("says Sales grew every month since the start of a rising run of finished months", () => {
    expect(salesHeadline(months(10, 20, 30, 40, 50, 5))).toBe("Sales have grown every month since May");
  });

  it("starts the run where the growth starts", () => {
    expect(salesHeadline(months(90, 20, 30, 40, 50, 5))).toBe("Sales have grown every month since June");
  });

  it("says Sales fell every month for a falling run", () => {
    expect(salesHeadline(months(50, 40, 30, 20, 10, 5))).toBe("Sales have fallen every month since May");
  });

  it("never claims a trend the finished months do not show", () => {
    expect(salesHeadline(months(10, 30, 20, 40, 30, 50))).toBe("Sales, last six months");
  });

  it("falls back to the neutral title for flat or empty months", () => {
    expect(salesHeadline(months(0, 0, 0, 0, 0, 0))).toBe("Sales, last six months");
    expect(salesHeadline(months(10, 10, 10, 10, 10, 10))).toBe("Sales, last six months");
  });

  it("ignores the unfinished month when judging the trend", () => {
    expect(salesHeadline(months(10, 20, 30, 40, 50, 0))).toBe("Sales have grown every month since May");
  });
});

describe("the so-far note", () => {
  it("compares the current month with the previous month", () => {
    expect(soFarNote(months(0, 0, 0, 0, 200_000, 50_000), pesos)).toBe("25% of September's ₱2,000 so far");
  });

  it("says when the month is already ahead", () => {
    expect(soFarNote(months(0, 0, 0, 0, 100_000, 150_000), pesos)).toBe("Already ahead of September's ₱1,000");
  });

  it("says when the month is level, not ahead", () => {
    expect(soFarNote(months(0, 0, 0, 0, 100_000, 100_000), pesos)).toBe("Level with September's ₱1,000");
  });

  it("never rounds a month that is still behind up to 100%", () => {
    expect(soFarNote(months(0, 0, 0, 0, 100_000, 99_900), pesos)).toBe("99% of September's ₱1,000 so far");
  });

  it("says there were no Sales last month", () => {
    expect(soFarNote(months(0, 0, 0, 0, 0, 50_000), pesos)).toBe("No Sales last month");
  });
});

describe("the six-month Sales chart", () => {
  it("shows six months with the current one marked so far, and its note", () => {
    render(<SalesChart widget={{ ok: true, months: months(10, 20, 30, 40, 100_000, 50_000) }} format={pesos} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("so far")).toBeTruthy();
    expect(screen.getByText("50% of September's ₱1,000 so far")).toBeTruthy();
  });

  it("shows the neutral title when no trend is true", () => {
    render(<SalesChart widget={{ ok: true, months: months(10, 30, 20, 40, 30, 50) }} format={pesos} />);

    expect(screen.getByRole("heading", { name: "Sales, last six months" })).toBeTruthy();
  });

  it("shows Couldn't load in its own card when the chart failed", () => {
    render(<SalesChart widget={{ ok: false }} format={pesos} />);

    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });

  it("has its own skeleton", () => {
    render(<SalesChartSkeleton />);

    expect(screen.getByRole("status", { name: "Loading Sales by month" })).toBeTruthy();
  });
});
