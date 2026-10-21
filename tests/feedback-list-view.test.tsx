// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FeedbackListView } from "@/features/feedback/feedback-list";
import type { FeedbackList, FeedbackRow } from "@/features/feedback/feedback";

afterEach(cleanup);

const row = (overrides: Partial<FeedbackRow> = {}): FeedbackRow => ({
  orderId: 1040,
  customerId: "c1",
  customerName: "Ana Reyes",
  rating: 4,
  comment: "Ordered for the office.",
  products: ["Smooth tub", "Tidbits pouch"],
  createdAt: new Date("2026-10-05T00:00:00Z"),
  ...overrides,
});

const list = (rows: FeedbackRow[], extra: Partial<FeedbackList> = {}): FeedbackList => ({
  rows,
  total: rows.length,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  ...extra,
});

describe("the Feedback list", () => {
  it("shows stars, Customer, Order, products, comment and date", () => {
    render(<FeedbackListView list={list([row()])} />);

    expect(screen.getByRole("img", { name: "4 out of 5 stars" }).textContent).toBe("★★★★☆");
    expect(screen.getByText(/Smooth tub, Tidbits pouch/)).toBeTruthy();
    expect(screen.getByText("Ordered for the office.")).toBeTruthy();
    expect(screen.getByText("5 Oct 2026")).toBeTruthy();
  });

  it("links the Customer name to the Profile and the Order number to the Order", () => {
    render(<FeedbackListView list={list([row()])} />);

    expect(screen.getByRole("link", { name: "Ana Reyes" }).getAttribute("href")).toBe("/customer-profiles/c1");
    expect(screen.getByRole("link", { name: "#1040" }).getAttribute("href")).toBe("/customer-profiles/c1#order-1040");
  });

  it("shows an empty state when there is no Feedback", () => {
    render(<FeedbackListView list={list([])} />);

    expect(screen.getByText("No Feedback yet.")).toBeTruthy();
  });

  it("pages with Previous and Next, keeping the list in its own scrolling container", () => {
    const { container } = render(<FeedbackListView list={list([row()], { page: 2, totalPages: 3 })} />);

    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Previous/ }).getAttribute("href")).toBe("/feedback");
    expect(screen.getByRole("link", { name: /Next/ }).getAttribute("href")).toBe("/feedback?page=3");
    expect(container.querySelector("ul")?.className).toContain("overflow-auto");
  });

  it("leaves out everything the spec removed", () => {
    render(<FeedbackListView list={list([row({ rating: 1 })])} />);

    expect(screen.queryByText(/export|how feedback works|ticket|website/i)).toBeNull();
  });
});
