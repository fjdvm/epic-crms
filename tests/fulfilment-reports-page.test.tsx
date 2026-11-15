// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Loading from "@/app/(app)/fulfilment/reports/loading";
import { FulfilmentReportView, formatHours, formatRate } from "@/features/reports/fulfilment-report-view";

afterEach(cleanup);

describe("Fulfilment reports page", () => {
  it("shows the loading state with the page chrome at once", () => {
    render(<Loading />);
    expect(screen.getByRole("heading", { name: "Fulfilment reports" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading Fulfilment reports" })).toBeTruthy();
  });

  it("shows the four figures and no on-time delivery", () => {
    render(<FulfilmentReportView figures={{ placedToDispatched: 18720, dispatchedToDelivered: null, cancellationRate: 0.031, returnRate: null, placed: 10, delivered: 0 }} />);
    expect(screen.getByText("5.2 h")).toBeTruthy();
    expect(screen.getByText("3.1%")).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText(/on-time/i)).toBeNull();
  });

  it("formats missing figures as a dash", () => {
    expect(formatHours(null)).toBe("—");
    expect(formatRate(null)).toBe("—");
  });
});
