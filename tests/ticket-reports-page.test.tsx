// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Loading from "@/app/(app)/tickets/reports/loading";
import type { TicketReport } from "@/features/reports/ticket-report";
import { TicketReportView, formatDuration, formatShare } from "@/features/reports/ticket-report-view";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
afterEach(cleanup);

const report: TicketReport = {
  targets: { firstReplyHours: 24, resolveHours: 72 },
  firstReplyMedian: 9000, resolveMedian: 90_000, metShare: 2 / 3, judged: 3, reopenRate: 0.25, reopened: 1, resolvedCount: 4,
  averageRating: 3.5, rated: 2, escalated: 5,
  categories: [{ category: "Delivery", count: 4 }, { category: "Refund", count: 1 }],
  staff: [{ id: "u1", name: "Ana", open: 2, resolved: 3, averageRating: 4, rated: 1 }],
  lowest: [{ ticketId: 12, subject: "Cake arrived broken", customerName: "Maria", rating: 1, comment: "Late again", ratedAt: new Date() }],
};

describe("Ticket reports page", () => {
  it("shows the loading state with the page chrome and periods at once", () => {
    render(<Loading />);
    expect(screen.getByRole("heading", { name: "Ticket reports" })).toBeTruthy();
    expect(screen.getByText("30 days")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading Ticket reports" })).toBeTruthy();
  });

  it("shows the figures, categories, Staff load and lowest ratings with links", () => {
    render(<TicketReportView report={report} />);
    expect(screen.getByText("2h 30m")).toBeTruthy();
    expect(screen.getByText("1d 1h")).toBeTruthy();
    expect(screen.getByText("66.7%")).toBeTruthy();
    expect(screen.getByText("25.0%")).toBeTruthy();
    expect(screen.getByText("3.5 / 5")).toBeTruthy();
    expect(screen.getByText("Delivery")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("Late again")).toBeTruthy();
    expect(screen.getByRole("link", { name: "TKT-12" }).getAttribute("href")).toBe("/tickets/12");
  });

  it("drops the channel, export, satisfaction chart and AI figures", () => {
    render(<TicketReportView report={report} />);
    expect(screen.queryByText(/where tickets came from|channel|export|\bai\b/i)).toBeNull();
  });

  it("shows empty states and dashes when nothing happened", () => {
    render(<TicketReportView report={{ ...report, firstReplyMedian: null, metShare: null, categories: [], staff: [], lowest: [] }} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(1);
    expect(screen.getByText("No Ticket was rated in this period.")).toBeTruthy();
    expect(formatDuration(null)).toBe("—");
    expect(formatShare(null)).toBe("—");
  });
});
