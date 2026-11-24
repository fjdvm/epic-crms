// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AreaMap, AreaMapSkeleton, metricValue, orderChange } from "@/features/ai-insights/area-map";
import type { AreaFigures, AreaInsights } from "@/features/ai-insights/areas";

afterEach(cleanup);

const area = (key: string, name: string, figures: Partial<AreaFigures> = {}): AreaFigures => ({
  key, name, orders: 0, sales: 0, cod: 0, failed: 0, returned: 0, previousOrders: 0, cities: [], ...figures,
});

const insights: AreaInsights = {
  areas: [
    area("cavite", "Cavite", { orders: 10, sales: 500000, failed: 1, previousOrders: 5,
      cities: [{ name: "City of Bacoor", orders: 6, sales: 300000 }, { name: "City of Imus", orders: 4, sales: 200000 }] }),
    area("metro manila", "Metro Manila", { orders: 4, sales: 900000, failed: 2, previousOrders: 8 }),
    area("cebu", "Cebu", { orders: 1, sales: 10000, failed: 1 }),
  ],
  unmapped: { orders: 2, sales: 5000 },
};

const ranking = () => within(screen.getByRole("list")).getAllByRole("button").map((b) => b.textContent);

describe("AreaMap", () => {
  it("ranks areas by Orders with the change against the period before, and counts addresses it can't place", () => {
    render(<AreaMap insights={insights} />);
    expect(ranking()).toEqual(["1Cavite▲ +100%10", "2Metro Manila▼ -50%4", "3Cebu▲ New1"]);
    expect(screen.getByText("2 Orders have an address the map can't place.")).toBeTruthy();
    expect(screen.getByRole("img", { name: /shaded by Orders/ })).toBeTruthy();
  });

  it("switches the measure at once, and leaves out areas with too few Orders for a rate", () => {
    render(<AreaMap insights={insights} />);
    fireEvent.click(screen.getByRole("radio", { name: "Failed deliveries" }));
    expect(screen.getByRole("radio", { name: "Failed deliveries" }).getAttribute("aria-checked")).toBe("true");
    expect(ranking()).toEqual(["1Metro Manila▼ -50%50%", "2Cavite▲ +100%10%"]);
  });

  it("opens an area's figures and top cities, and goes back to the list", () => {
    render(<AreaMap insights={insights} />);
    fireEvent.click(screen.getByRole("button", { name: /Cavite/ }));
    expect(screen.getByRole("heading", { name: "Cavite" })).toBeTruthy();
    expect(screen.getByText("City of Bacoor")).toBeTruthy();
    expect(screen.getByText("₱500.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← All areas" }));
    expect(screen.getByRole("heading", { name: "Top areas by orders" })).toBeTruthy();
  });

  it("shades the busiest area darkest and areas with no Orders gray", () => {
    const { container } = render(<AreaMap insights={insights} />);
    expect(container.querySelector('[data-area="cavite"]')?.getAttribute("fill")).toBe("#5b2a86");
    expect(container.querySelector('[data-area="bohol"]')?.getAttribute("fill")).toBe("#f1f0f3");
  });

  it("says so when there are no delivery Orders", () => {
    render(<AreaMap insights={{ areas: [], unmapped: { orders: 0, sales: 0 } }} />);
    expect(screen.getByText("No delivery Orders in this period")).toBeTruthy();
  });

  it("has a skeleton to show at once while the figures load", () => {
    render(<AreaMapSkeleton />);
    expect(screen.getByRole("region", { name: "Where our Orders go" }).getAttribute("aria-busy")).toBe("true");
  });
});

describe("area figures", () => {
  it("gives rates only from three Orders up, and no change without a period before", () => {
    expect(metricValue(area("a", "A", { orders: 2, failed: 1 }), "failed")).toBeNull();
    expect(metricValue(area("a", "A", { orders: 4, cod: 1 }), "cod")).toBe(0.25);
    expect(orderChange(area("a", "A"))).toBeNull();
    expect(orderChange(area("a", "A", { orders: 3, previousOrders: 3 }))).toBeNull();
  });
});
