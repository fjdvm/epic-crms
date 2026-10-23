// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReturnListView } from "@/features/returns/return-list";
import {
  RETURN_STATUSES,
  type ReturnList,
  type ReturnRow,
  type ReturnStats,
  type ReturnStatus,
  type ReturnTab,
} from "@/features/returns/returns";

afterEach(cleanup);

const row = (overrides: Partial<ReturnRow>): ReturnRow => ({
  id: 15,
  number: "RMA-15",
  orderId: 1042,
  customer: { id: "c1", name: "Maria Santos" },
  status: "requested",
  requestedAt: new Date("2026-10-20T00:00:00Z"),
  amount: 21_900,
  items: [{ orderLineId: 1, product: "Smooth tub", size: "250g", quantity: 2, price: 10_950 }],
  ...overrides,
});

const counts = (overrides: Partial<Record<ReturnStatus, number>>) =>
  Object.fromEntries(RETURN_STATUSES.map((s) => [s, overrides[s] ?? 0])) as Record<ReturnStatus, number>;

const list = (rows: ReturnRow[], overrides: Partial<ReturnList> = {}): ReturnList => ({
  rows,
  counts: counts({ requested: 3, approved: 2, "goods received": 1, refunded: 4, declined: 1, cancelled: 5 }),
  page: 1,
  pageSize: 25,
  total: rows.length,
  totalPages: 1,
  ...overrides,
});

const STATS: ReturnStats = {
  openReturns: 6,
  requestedThisMonth: 3,
  deliveredThisMonth: 500,
  returnRate: 0.6,
  refundedThisMonth: 295_000,
};

function view(
  rows: ReturnRow[],
  options: { tab?: ReturnTab; stats?: ReturnStats | null; list?: Partial<ReturnList> } = {},
) {
  return render(
    <ReturnListView
      list={list(rows, options.list)}
      stats={options.stats === undefined ? STATS : options.stats}
      params={{ tab: options.tab ?? "requested", page: options.list?.page ?? 1 }}
    />,
  );
}

describe("the Returns page", () => {
  it("shows the three stat cards from the read model and no Replacements stat", () => {
    view([row({})]);

    const open = screen.getByText("Open returns").parentElement!;
    expect(within(open).getByText("6")).toBeTruthy();
    const rate = screen.getByText("Return rate").parentElement!;
    expect(within(rate).getByText("0.6%")).toBeTruthy();
    expect(within(rate).getByText("Of delivered Orders")).toBeTruthy();
    const refunded = screen.getByText("Refunded this month").parentElement!;
    expect(within(refunded).getByText("₱2,950.00")).toBeTruthy();
    expect(screen.queryByText(/replacement/i)).toBeNull();
  });

  it("says the stats are unavailable rather than showing zeros", () => {
    view([row({})], { stats: null });

    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
  });

  it("has a tab per status with its count, and no All or Cancelled tab", () => {
    view([row({})]);

    const tabs = within(screen.getByRole("navigation", { name: "Return tabs" })).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Requested 3",
      "Approved 2",
      "Goods received 1",
      "Refunded 4",
      "Declined 1",
    ]);
    expect(tabs[0].getAttribute("aria-current")).toBe("page");
    expect(tabs[1].getAttribute("href")).toBe("/returns?tab=approved");
    expect(tabs[0].getAttribute("href")).toBe("/returns");
  });

  it("has the table columns, without a Resolution column or a New return button", () => {
    view([row({})]);

    const headers = Array.from(document.querySelectorAll("[data-return-head] > div")).map((c) => c.textContent);
    expect(headers).toEqual(["Return", "Customer", "Order", "Items", "Status", "Requested"]);
    expect(screen.queryByText("Resolution")).toBeNull();
    expect(screen.queryByText(/new return/i)).toBeNull();
  });

  it("shows a Return's number, Customer, Order, items, status and requested date", () => {
    view([
      row({
        items: [
          { orderLineId: 1, product: "Smooth tub", size: "250g", quantity: 2, price: 1 },
          { orderLineId: 2, product: "Powder", size: "100g", quantity: 1, price: 1 },
        ],
      }),
    ]);

    const r = document.querySelector("[data-return-row]") as HTMLElement;
    expect(within(r).getByText("RMA-15")).toBeTruthy();
    expect(within(r).getByText("Maria Santos")).toBeTruthy();
    expect(within(r).getByRole("link", { name: "#1042" }).getAttribute("href")).toBe("/orders/1042");
    expect(within(r).getByText("Smooth tub ×2, Powder ×1")).toBeTruthy();
    expect(within(r).getByText("Requested")).toBeTruthy();
    expect(within(r).getByText("20 Oct 2026")).toBeTruthy();
  });

  it("keeps the read model's order of rows", () => {
    view([row({ id: 3, number: "RMA-3" }), row({ id: 9, number: "RMA-9" })]);

    const rows = Array.from(document.querySelectorAll("[data-return-row]"));
    expect(rows[0].textContent).toContain("RMA-3");
    expect(rows[1].textContent).toContain("RMA-9");
  });

  it("says when a tab has no Returns", () => {
    view([], { tab: "declined" });

    expect(screen.getByText("No Declined Returns.")).toBeTruthy();
  });

  it("pages through a long tab, keeping the tab in the links", () => {
    view([row({})], { tab: "refunded", list: { page: 2, totalPages: 3 } });

    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Previous/ }).getAttribute("href")).toBe("/returns?tab=refunded");
    expect(screen.getByRole("link", { name: /Next/ }).getAttribute("href")).toBe("/returns?tab=refunded&page=3");
  });
});
