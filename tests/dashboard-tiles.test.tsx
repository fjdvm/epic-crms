// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BuyersTile, OrdersTile, RatingTile, StatTile, StatTileSkeleton } from "@/features/dashboard/stat-tile";

afterEach(cleanup);

const pesos = (centavos: number) => `₱${(centavos / 100).toLocaleString("en-PH")}`;

describe("a Dashboard stat tile", () => {
  it("shows the figure and how it moved against the previous period", () => {
    render(<StatTile title="Sales" widget={{ ok: true, current: 112_000, previous: 100_000 }} format={pesos} />);

    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.getByText("₱1,120")).toBeTruthy();
    expect(screen.getByText("↑ 12% vs previous period")).toBeTruthy();
  });

  it("shows a fall as a fall", () => {
    render(<StatTile title="Orders" widget={{ ok: true, current: 3, previous: 4 }} format={String} />);

    expect(screen.getByText("↓ 25% vs previous period")).toBeTruthy();
  });

  it("says there was no change when the figures match", () => {
    render(<StatTile title="Orders" widget={{ ok: true, current: 4, previous: 4 }} format={String} />);

    expect(screen.getByText("No change vs previous period")).toBeTruthy();
  });

  it("says No Orders last period instead of a percentage when the previous period was zero", () => {
    render(<StatTile title="Sales" widget={{ ok: true, current: 50_000, previous: 0 }} format={pesos} />);

    expect(screen.getByText("No Orders last period")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("shows zeros for an empty period", () => {
    render(<StatTile title="Orders" widget={{ ok: true, current: 0, previous: 0 }} format={String} />);

    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("No Orders last period")).toBeTruthy();
  });

  it("shows Couldn't load in its own card when the widget failed", () => {
    render(<StatTile title="Sales" widget={{ ok: false }} format={pesos} />);

    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });

  it("has a skeleton labelled by its own title", () => {
    render(<StatTileSkeleton title="Orders" />);

    expect(screen.getByRole("status", { name: "Loading Orders" })).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
  });
});

describe("the Average order tile", () => {
  it("compares with the previous period like any money tile", () => {
    render(
      <StatTile title="Average order" widget={{ ok: true, current: 150_000, previous: 100_000 }} format={pesos} />,
    );

    expect(screen.getByText("₱1,500")).toBeTruthy();
    expect(screen.getByText("↑ 50% vs previous period")).toBeTruthy();
  });
});

describe("the Returning Buyers tile", () => {
  const widget = (share: number | null, buyers: number) => ({ share, buyers });

  it("says Buyer for one", () => {
    render(<BuyersTile widget={{ ok: true, current: widget(0, 1), previous: widget(null, 0) }} />);

    expect(screen.getByText("of 1 Buyer with Orders counted in Sales")).toBeTruthy();
  });

  it("shows the share and how it moved in points", () => {
    render(
      <BuyersTile
        widget={{
          ok: true,
          current: widget(0.5, 4),
          previous: widget(0.25, 4),
        }}
      />,
    );

    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("of 4 Buyers with Orders counted in Sales")).toBeTruthy();
    expect(screen.getByText("↑ 25 pts vs previous period")).toBeTruthy();
  });

  it("says No Buyers last period when the previous period had none", () => {
    render(
      <BuyersTile
        widget={{
          ok: true,
          current: widget(0.5, 4),
          previous: widget(null, 0),
        }}
      />,
    );

    expect(screen.getByText("No Buyers last period")).toBeTruthy();
  });

  it("says No Buyers yet when the period has none", () => {
    render(
      <BuyersTile
        widget={{
          ok: true,
          current: widget(null, 0),
          previous: widget(0.5, 2),
        }}
      />,
    );

    expect(screen.getByText("No Buyers yet")).toBeTruthy();
    expect(screen.queryByText(/pts/)).toBeNull();
  });

  it("shows Couldn't load when it failed", () => {
    render(<BuyersTile widget={{ ok: false }} />);

    expect(screen.getByText("Returning Buyers")).toBeTruthy();
    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });
});

describe("the Average rating tile", () => {
  it("shows the average with the Feedback count", () => {
    render(
      <RatingTile
        widget={{
          ok: true,
          current: { average: 4.25, count: 8 },
          previous: { average: 4, count: 3 },
        }}
      />,
    );

    expect(screen.getByText("4.3 ★")).toBeTruthy();
    expect(screen.getByText("From 8 Feedback")).toBeTruthy();
    expect(screen.getByText("↑ 0.3 vs previous period")).toBeTruthy();
  });

  it("says No Feedback yet instead of a rating when none was given", () => {
    render(
      <RatingTile
        widget={{
          ok: true,
          current: { average: null, count: 0 },
          previous: { average: 4, count: 3 },
        }}
      />,
    );

    expect(screen.getByText("No Feedback yet")).toBeTruthy();
    expect(screen.queryByText(/★/)).toBeNull();
    expect(screen.queryByText(/vs previous/)).toBeNull();
  });

  it("says No Feedback last period when the previous period had none", () => {
    render(
      <RatingTile
        widget={{
          ok: true,
          current: { average: 5, count: 1 },
          previous: { average: null, count: 0 },
        }}
      />,
    );

    expect(screen.getByText("No Feedback last period")).toBeTruthy();
  });

  it("shows Couldn't load when it failed", () => {
    render(<RatingTile widget={{ ok: false }} />);

    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });
});

describe("the Orders tile", () => {
  const show = (placed: number, counted: number) => render(
    <OrdersTile widget={{ ok: true, current: { placed, counted }, previous: { placed: 4, counted: 4 } }} />,
  );

  it("splits the Orders placed into counted in Sales and not yet", () => {
    show(2, 1);

    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1 counted in Sales · 1 not counted yet")).toBeTruthy();
    expect(screen.getByText("↓ 50% vs previous period")).toBeTruthy();
  });

  it("says when all are counted", () => {
    show(3, 3);

    expect(screen.getByText("All counted in Sales")).toBeTruthy();
  });

  it("says nothing about Sales with no Orders", () => {
    show(0, 0);

    expect(screen.queryByText(/counted/)).toBeNull();
  });

  it("shows Couldn't load when it failed", () => {
    render(<OrdersTile widget={{ ok: false }} />);

    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });
});
