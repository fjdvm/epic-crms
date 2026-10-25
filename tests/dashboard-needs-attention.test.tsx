// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { hasAttentionQueue, type Attention } from "@/features/dashboard/attention";
import { NeedsAttention, NeedsAttentionSkeleton, oldestAge } from "@/features/dashboard/needs-attention";

afterEach(cleanup);

const now = new Date("2026-10-25T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

const full: Attention = {
  paymentProofs: { ok: true, count: 4, oldest: hoursAgo(3) },
  deliveryFees: { ok: true, count: 2, oldest: hoursAgo(26) },
  ordersToPack: { ok: true, count: 5, oldest: hoursAgo(1) },
  codToCollect: { ok: true, count: 3, oldest: hoursAgo(50), centavos: 1_250_000 },
  openTickets: { ok: true, count: 6, oldest: hoursAgo(0.2), overdue: 2 },
  returns: { ok: true, count: 1, oldest: hoursAgo(72) },
  lowFeedback: { ok: true, count: 7, oldest: hoursAgo(5) },
};

const row = (title: string) => screen.getByRole("link", { name: new RegExp(`^${title}`) }).closest("li")!;

describe("the oldest item's age", () => {
  it("is worded in the largest whole unit", () => {
    expect(oldestAge(hoursAgo(0.2), now)).toBe("Oldest is under an hour old");
    expect(oldestAge(hoursAgo(1), now)).toBe("Oldest is 1 hour old");
    expect(oldestAge(hoursAgo(3), now)).toBe("Oldest is 3 hours old");
    expect(oldestAge(hoursAgo(26), now)).toBe("Oldest is 1 day old");
    expect(oldestAge(hoursAgo(72), now)).toBe("Oldest is 3 days old");
  });
});

describe("the Needs attention card", () => {
  it("shows up to seven rows, each linking to its filtered page", () => {
    render(<NeedsAttention attention={full} now={now} />);

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));

    expect(hrefs).toEqual([
      "/payments",
      "/orders?tab=placed",
      "/fulfilment",
      "/fulfilment",
      "/tickets?tab=open",
      "/returns?tab=requested",
      "/feedback",
    ]);
  });

  it("uses glossary wording and shows each count and the oldest age", () => {
    render(<NeedsAttention attention={full} now={now} />);

    const proofs = within(row("Payment proofs to check"));

    expect(proofs.getByText("Oldest is 3 hours old")).toBeTruthy();
    expect(proofs.getByText("4")).toBeTruthy();
    expect(row("Low Feedback to review")).toBeTruthy();
  });

  it("shows the pesos total on COD to collect and the Overdue count on Open Tickets", () => {
    render(<NeedsAttention attention={full} now={now} />);

    expect(within(row("COD to collect")).getByText(/₱12,500/)).toBeTruthy();
    expect(within(row("Open Tickets")).getByText(/2 Overdue/)).toBeTruthy();
  });

  it("hides rows for Modules the Staff member does not hold", () => {
    render(<NeedsAttention attention={{ returns: full.returns, lowFeedback: full.lowFeedback }} now={now} />);

    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      expect.stringContaining("Returns to decide"),
      expect.stringContaining("Low Feedback to review"),
    ]);
    expect(screen.queryByText("Payment proofs to check")).toBeNull();
  });

  it("keeps a zero count visible but greyed", () => {
    render(<NeedsAttention attention={{ paymentProofs: { ok: true, count: 0, oldest: null } }} now={now} />);

    const zero = row("Payment proofs to check");

    expect(within(zero).getByText("0")).toBeTruthy();
    expect(within(zero).getByText("Nothing waiting")).toBeTruthy();
    expect(zero.dataset.empty).toBe("true");
  });

  it("marks a row that could not load, leaving the others standing", () => {
    render(<NeedsAttention attention={{ paymentProofs: { ok: false }, returns: full.returns }} now={now} />);

    expect(within(row("Payment proofs to check")).getByText("Couldn't load")).toBeTruthy();
    expect(within(row("Returns to decide")).getByText("1")).toBeTruthy();
  });

  it("says so when the Staff member holds none of the queues' Modules", () => {
    render(<NeedsAttention attention={{}} now={now} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Nothing for you to work on here")).toBeTruthy();
  });

  it("has a skeleton that keeps the title as static chrome", () => {
    render(<NeedsAttentionSkeleton />);

    expect(screen.getByRole("status", { name: "Loading Needs attention" })).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
  });
});

describe("which Staff get the card", () => {
  it("is only those holding a Module that has a queue", () => {
    expect(hasAttentionQueue(["Returns"])).toBe(true);
    expect(hasAttentionQueue(["Marketing", "Customer Profiles"])).toBe(false);
  });
});
