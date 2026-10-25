// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatTile, StatTileSkeleton } from "@/features/dashboard/stat-tile";

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
