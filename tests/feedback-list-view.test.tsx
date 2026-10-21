// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeedbackFilters } from "@/features/feedback/filters";
import { FeedbackSummaryCards } from "@/features/feedback/feedback-summary";
import { DateRangeButton, rangeLabel } from "@/features/feedback/feedback-toolbar";
import { FeedbackListView } from "@/features/feedback/feedback-list";
import { lastAnalyzedLabel } from "@/features/feedback/sentiment-badge";
import type { FeedbackList, FeedbackRow } from "@/features/feedback/feedback";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NO_FILTERS: FeedbackFilters = { page: 1 };

const row = (overrides: Partial<FeedbackRow> = {}): FeedbackRow => ({
  orderId: 1040,
  customerId: "c1",
  customerName: "Ana Reyes",
  rating: 4,
  comment: "Ordered for the office.",
  products: ["Smooth tub", "Tidbits pouch"],
  createdAt: new Date("2026-10-05T00:00:00Z"),
  sentiment: null,
  ...overrides,
});

const list = (rows: FeedbackRow[], extra: Partial<FeedbackList> = {}): FeedbackList => ({
  rows,
  products: ["Smooth tub", "Tidbits pouch"],
  summary: { count: rows.length, average: null, low: 0 },
  response: { requested: 0, received: 0, rate: null },
  total: rows.length,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  lastAnalyzed: null,
  ...extra,
});

describe("Sentiment badges and Last analyzed", () => {
  it("shows each Feedback's Sentiment", () => {
    render(
      <FeedbackListView
        list={list([
          row({ orderId: 1, sentiment: "positive" }),
          row({ orderId: 2, sentiment: "neutral" }),
          row({ orderId: 3, sentiment: "negative" }),
        ])}
        filters={NO_FILTERS}
      />,
    );

    expect(screen.getByText("Positive")).toBeTruthy();
    expect(screen.getByText("Neutral")).toBeTruthy();
    expect(screen.getByText("Negative")).toBeTruthy();
  });

  it("says Analysing… until a Feedback is labelled", () => {
    render(<FeedbackListView list={list([row({ sentiment: null })])} filters={NO_FILTERS} />);

    expect(screen.getByText("Analysing…")).toBeTruthy();
  });

  it("shows Last analyzed in Philippines time, and nothing before the first run", () => {
    expect(lastAnalyzedLabel(new Date("2026-10-21T06:00:00Z"))).toBe("Last analyzed 21 Oct 2026, 2:00 pm");
    expect(lastAnalyzedLabel(null)).toBeNull();
  });
});

describe("the Feedback list", () => {
  it("gives each Feedback an anchor the Feedback notification links to", () => {
    const { container } = render(<FeedbackListView list={list([row({ orderId: 1042 })])} filters={NO_FILTERS} />);

    expect(container.querySelector("#feedback-1042")).toBeTruthy();
  });

  it("shows stars, Customer, Order, products, comment and date", () => {
    render(<FeedbackListView list={list([row()])} filters={NO_FILTERS} />);

    expect(screen.getByRole("img", { name: "4 out of 5 stars" }).textContent).toBe("★★★★☆");
    expect(screen.getByRole("link", { name: "Smooth tub" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tidbits pouch" })).toBeTruthy();
    expect(screen.getByText("Ordered for the office.")).toBeTruthy();
    expect(screen.getByText("5 Oct 2026")).toBeTruthy();
  });

  it("links the Customer name to the Profile and the Order number to the Order", () => {
    render(<FeedbackListView list={list([row()])} filters={NO_FILTERS} />);

    expect(screen.getByRole("link", { name: "Ana Reyes" }).getAttribute("href")).toBe("/customer-profiles/c1");
    expect(screen.getByRole("link", { name: "#1040" }).getAttribute("href")).toBe("/customer-profiles/c1#order-1040");
  });

  it("links each product name to that product's view, keeping the other filters", () => {
    render(<FeedbackListView list={list([row()])} filters={{ stars: 2, from: "2026-10-01", page: 3 }} />);

    expect(screen.getByRole("link", { name: "Tidbits pouch" }).getAttribute("href")).toBe(
      "/feedback?from=2026-10-01&stars=2&product=Tidbits+pouch",
    );
  });

  it("shows an empty state when there is no Feedback", () => {
    render(<FeedbackListView list={list([])} filters={NO_FILTERS} />);

    expect(screen.getByText("No Feedback yet.")).toBeTruthy();
  });

  it("says so when the filters leave nothing", () => {
    render(<FeedbackListView list={list([])} filters={{ stars: 2, page: 1 }} />);

    expect(screen.getByText("No Feedback matches these filters.")).toBeTruthy();
  });

  it("keeps the range and star filter in the paging links", () => {
    render(
      <FeedbackListView
        list={list([row()], { page: 2, totalPages: 3 })}
        filters={{ from: "2026-10-01", to: "2026-10-31", stars: 2, page: 2 }}
      />,
    );

    expect(screen.getByRole("link", { name: /Next/ }).getAttribute("href")).toBe(
      "/feedback?from=2026-10-01&to=2026-10-31&stars=2&page=3",
    );
  });

  it("shows the star filter on its current rating", () => {
    render(<FeedbackListView list={list([row()])} filters={{ stars: 3, page: 1 }} />);

    expect(screen.getByRole("combobox", { name: "Rating" }).textContent).toContain("3 stars");
  });

  it("shows the product filter on its current product and on All products by default", () => {
    render(<FeedbackListView list={list([row()])} filters={NO_FILTERS} />);
    expect(screen.getByRole("combobox", { name: "Product" }).textContent).toContain("All products");

    cleanup();
    render(<FeedbackListView list={list([row()])} filters={{ product: "Smooth tub", page: 1 }} />);
    expect(screen.getByRole("combobox", { name: "Product" }).textContent).toContain("Smooth tub");
  });

  it("pages with Previous and Next, keeping the list in its own scrolling container", () => {
    const { container } = render(<FeedbackListView list={list([row()], { page: 2, totalPages: 3 })} filters={NO_FILTERS} />);

    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Previous/ }).getAttribute("href")).toBe("/feedback");
    expect(screen.getByRole("link", { name: /Next/ }).getAttribute("href")).toBe("/feedback?page=3");
    expect(container.querySelector("ul")?.className).toContain("overflow-auto");
  });

  it("leaves out everything the spec removed", () => {
    render(<FeedbackListView list={list([row({ rating: 1 })])} filters={NO_FILTERS} />);

    expect(screen.queryByText(/export|how feedback works|ticket|website/i)).toBeNull();
  });
});

describe("the product view", () => {
  const view = { product: "Smooth tub", stars: 5, page: 1 } satisfies FeedbackFilters;

  it("shows the product name, its Feedback count and the filtered list, with no average", () => {
    render(
      <FeedbackListView
        list={list([row()], { total: 12, summary: { count: 40, average: 4.1, low: 2 } })}
        filters={view}
      />,
    );

    expect(screen.getByRole("heading", { name: "Smooth tub" })).toBeTruthy();
    expect(screen.getByTestId("product-feedback-count").textContent).toBe("12 Feedback");
    expect(screen.getByText("Ordered for the office.")).toBeTruthy();
    expect(screen.queryByText(/average|4\.1/i)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Latest feedback" })).toBeNull();
  });

  it("goes back to all Feedback, keeping the other filters", () => {
    render(<FeedbackListView list={list([row()])} filters={view} />);

    expect(screen.getByRole("link", { name: /All Feedback/ }).getAttribute("href")).toBe("/feedback?stars=5");
  });

  it("says so when the product has no Feedback in the range", () => {
    render(<FeedbackListView list={list([], { total: 0 })} filters={view} />);

    expect(screen.getByTestId("product-feedback-count").textContent).toBe("0 Feedback");
    expect(screen.getByText("No Feedback matches these filters.")).toBeTruthy();
  });
});

const NO_RESPONSE = { requested: 0, received: 0, rate: null };
const NO_TOP = { ok: true, result: null } as const;

describe("the summary cards", () => {
  it("shows the response rate, as the Figma card words it", () => {
    render(
      <FeedbackSummaryCards
        summary={{ count: 0, average: null, low: 0 }}
        response={{ requested: 17, received: 7, rate: 41 }}
        topProduct={NO_TOP}
      />,
    );

    expect(screen.getByTestId("response-rate").textContent).toBe("Response rate41%Of delivery emails");
  });

  it("says No requests yet when none were sent in the range", () => {
    render(<FeedbackSummaryCards summary={{ count: 0, average: null, low: 0 }} response={NO_RESPONSE} topProduct={NO_TOP} />);

    expect(screen.getByTestId("response-rate").textContent).toBe("Response rateNo requests yet");
  });

  it("shows the average rating with its review count, and the low ratings", () => {
    render(<FeedbackSummaryCards summary={{ count: 64, average: 4.75, low: 3 }} response={NO_RESPONSE} topProduct={NO_TOP} />);

    expect(screen.getByTestId("average-rating").textContent).toBe("Average rating4.8 ★64 Feedback");
    expect(screen.getByTestId("low-ratings").textContent).toBe("Low ratings31 to 3 stars");
  });

  it("shows a dash instead of an average when there is no Feedback", () => {
    render(<FeedbackSummaryCards summary={{ count: 0, average: null, low: 0 }} response={NO_RESPONSE} topProduct={NO_TOP} />);

    expect(screen.getByTestId("average-rating").textContent).toBe("Average rating–0 Feedback");
  });

  it("shows the Top product with its Feedback count, its reason and an All time label", () => {
    render(
      <FeedbackSummaryCards
        summary={{ count: 0, average: null, low: 0 }}
        response={NO_RESPONSE}
        topProduct={{
          ok: true,
          result: {
            product: "Halaya Smooth",
            feedbackCount: 31,
            reason: "Customers keep praising how creamy it is.",
            model: "groq-4",
            computedAt: new Date("2026-10-21T03:00:00Z"),
          },
        }}
      />,
    );

    expect(screen.getByTestId("top-product").textContent).toBe(
      "Top productAll timeHalaya Smooth31 FeedbackCustomers keep praising how creamy it is.",
    );
  });

  it("says Not enough Feedback yet when no product qualifies", () => {
    render(<FeedbackSummaryCards summary={{ count: 0, average: null, low: 0 }} response={NO_RESPONSE} topProduct={NO_TOP} />);

    expect(screen.getByTestId("top-product").textContent).toBe("Top productAll timeNot enough Feedback yet");
  });

  it("says the Top product is unavailable when it could not be read, rather than not enough Feedback", () => {
    render(<FeedbackSummaryCards summary={{ count: 0, average: null, low: 0 }} response={NO_RESPONSE} topProduct={{ ok: false }} />);

    expect(screen.getByTestId("top-product").textContent).toBe("Top productAll timeUnavailable");
  });

  it("mentions no tickets and calls each one Feedback, not a review", () => {
    render(<FeedbackSummaryCards summary={{ count: 1, average: 5, low: 0 }} response={NO_RESPONSE} topProduct={NO_TOP} />);

    expect(screen.getByText("1 Feedback")).toBeTruthy();
    expect(screen.queryByText(/review/i)).toBeNull();
    expect(screen.queryByText(/ticket/i)).toBeNull();
  });
});

describe("the date range picker", () => {
  const open = (filters = NO_FILTERS) => {
    cleanup();
    render(<DateRangeButton filters={filters} today="2026-10-21" />);
    fireEvent.click(screen.getByRole("button", { name: /Date range/ }));
  };

  it("reads All time by default", () => {
    render(<DateRangeButton filters={NO_FILTERS} today="2026-10-21" />);

    expect(screen.getByRole("button", { name: "Date range: All time" })).toBeTruthy();
  });

  it("labels a range in the button", () => {
    expect(rangeLabel({ from: "2026-10-05", to: "2026-10-07" })).toBe("5 Oct – 7 Oct 2026");
    expect(rangeLabel({ from: "2026-10-05" })).toBe("From 5 Oct 2026");
  });

  it("shows two months", () => {
    open();

    expect(screen.getAllByRole("grid")).toHaveLength(2);
  });

  it("applies each quick link, counting days in Philippines time", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(push).toHaveBeenLastCalledWith("/feedback?from=2026-10-15&to=2026-10-21");

    open();
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(push).toHaveBeenLastCalledWith("/feedback?from=2026-09-22&to=2026-10-21");

    open();
    fireEvent.click(screen.getByRole("button", { name: "This year" }));
    expect(push).toHaveBeenLastCalledWith("/feedback?from=2026-01-01&to=2026-10-21");
  });

  it("applies a range once both days are picked", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /October(?:th)? 5(?:th)?, 2026/ }));
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /October(?:th)? 7(?:th)?, 2026/ }));
    expect(push).toHaveBeenCalledWith("/feedback?from=2026-10-05&to=2026-10-07");
  });

  it("clears back to All time, keeping the star filter", () => {
    open({ from: "2026-10-05", to: "2026-10-07", stars: 2, page: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(push).toHaveBeenCalledWith("/feedback?stars=2");
  });
});
