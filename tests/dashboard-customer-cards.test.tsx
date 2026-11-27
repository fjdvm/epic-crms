// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CustomersByStageCard, CustomersByStageSkeleton, NewCustomersCard, NewCustomersSkeleton } from "@/features/dashboard/customer-cards";

afterEach(cleanup);

describe("Customers by Stage", () => {
  it("shows all five Stages as of today, saying what they count, and links At risk to Customer Profiles", () => {
    render(<CustomersByStageCard widget={{ ok: true, counts: {
      new: 12, "first-order": 8, repeat: 25, "at-risk": 6, lost: 3,
    } }} />);

    expect(screen.getByRole("heading", { name: "Customers by Stage" })).toBeTruthy();
    expect(screen.getByText("As of today · all verified Customers · counts every Order not cancelled, paid or not")).toBeTruthy();
    for (const [label, count] of [["No Orders yet", "12"], ["First order", "8"], ["Repeat", "25"], ["At risk", "6"], ["Lost", "3"]]) {
      expect(within(screen.getByText(label).closest("li")!).getByText(count)).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: /6 At risk Customers/ }).getAttribute("href"))
      .toBe("/customer-profiles?stage=at-risk");
  });
});

describe("New Customers", () => {
  it("shows the selected period and comparison, with unverified Leads separate", () => {
    render(<NewCustomersCard widget={{ ok: true, current: 15, previous: 10 }}
      leads={{ ok: true, count: 7 }} periodLabel="This month" />);

    expect(screen.getByRole("heading", { name: "New Customers" })).toBeTruthy();
    expect(screen.getByText("This month")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("↑ 50% vs previous period")).toBeTruthy();
    expect(screen.getByText("Unverified Leads (as of today): 7")).toBeTruthy();
  });
});

it("keeps all five Stages and a zero At risk callout when there are no Customers", () => {
  render(<CustomersByStageCard widget={{ ok: true, counts: {
    new: 0, "first-order": 0, repeat: 0, "at-risk": 0, lost: 0,
  } }} />);

  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  expect(screen.getAllByText("0")).toHaveLength(5);
  expect(screen.getByRole("link", { name: /0 At risk Customers/ })).toBeTruthy();
});

it("shows zero New Customers without a percentage when there were none last period", () => {
  render(<NewCustomersCard widget={{ ok: true, current: 0, previous: 0 }}
    leads={{ ok: true, count: 0 }} periodLabel="Today" />);

  expect(screen.getByText("0")).toBeTruthy();
  expect(screen.getByText("No Customers last period")).toBeTruthy();
  expect(screen.getByText("Unverified Leads (as of today): 0")).toBeTruthy();
  expect(screen.queryByText(/%/)).toBeNull();
});

it("fails the Stage card without hiding New Customers", () => {
  render(<>
    <CustomersByStageCard widget={{ ok: false }} />
    <NewCustomersCard widget={{ ok: true, current: 3, previous: 4 }}
      leads={{ ok: true, count: 2 }} periodLabel="7 days" />
  </>);

  expect(screen.getByText(/^As of today/)).toBeTruthy();
  expect(screen.getByText("Couldn't load")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("3")).toBeTruthy();
  expect(screen.getByText("↓ 25% vs previous period")).toBeTruthy();
});

it("keeps Leads separate when New Customers fails", () => {
  render(<NewCustomersCard widget={{ ok: false }} leads={{ ok: true, count: 5 }} periodLabel="90 days" />);

  expect(screen.getByText("Couldn't load")).toBeTruthy();
  expect(screen.getByText("Unverified Leads (as of today): 5")).toBeTruthy();
  expect(screen.queryByText(/vs previous period/)).toBeNull();
});

it("keeps New Customers when Leads fails", () => {
  render(<NewCustomersCard widget={{ ok: true, current: 8, previous: 8 }}
    leads={{ ok: false }} periodLabel="Last month" />);

  expect(screen.getByText("8")).toBeTruthy();
  expect(screen.getByText("No change vs previous period")).toBeTruthy();
  expect(screen.getByText("Unverified Leads (as of today): Couldn't load")).toBeTruthy();
});

it("labels each card's own skeleton", () => {
  render(<><CustomersByStageSkeleton /><NewCustomersSkeleton periodLabel="This month" /></>);

  expect(screen.getByRole("status", { name: "Loading Customers by Stage" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Loading New Customers" })).toBeTruthy();
  expect(screen.getByText(/^As of today/)).toBeTruthy();
  expect(screen.getByText("This month")).toBeTruthy();
});
