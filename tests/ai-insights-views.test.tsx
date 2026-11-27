// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
    const props: Record<string, unknown> = { ...rest };
    delete props.prefetch;
    return <a href={href} {...props}>{children}</a>;
  },
}));

import { AreaSection, VIEWS } from "@/features/ai-insights/area-map";
import { InsightGrid } from "@/features/ai-insights/insight-grid";
import { tabFor } from "@/features/ai-insights/view-model";
import { emptyStats, type AreaFigures, type Insight, type ProductFigures } from "@/features/ai-insights/insights";
import { Brief, StatRow } from "@/features/ai-insights/sections";

const card = (over: Partial<Insight> = {}): Insight => ({
  key: "payments:expiring", category: "payments", module: "Payments", priority: "high", confidence: "high",
  confidenceReason: "High because it comes from each Order's saved payment deadline.",
  headline: "5 unpaid Orders will auto-cancel within 24 hours", basedOn: "GCash, Maya or bank transfer Orders",
  steps: ["Listed the unpaid Orders.", "Kept the ones due within 24 hours."], numbers: { orders: 5 },
  records: [{ type: "order", id: 7 }], action: { label: "Open Payments", href: "/payments" },
  nextStep: "Message these Customers before the deadline.", ai: "These 5 cancel soon; a reminder may help.", ...over,
});
const stock = card({ key: "stock:12", category: "stock", module: "Orders", priority: "watch", confidence: "low", headline: "Ube halaya may run out in about 4 days", ai: null, action: { label: "Open Stock", href: "/orders/stock" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("Insights to look at", () => {
  it("shows each card's evidence line, AI box with confidence, and a plain link to its screen", () => {
    render(<InsightGrid initial={[card(), stock]} days={7} answers={{}} enoughData />);
    const first = screen.getByText(card().headline).closest("li")!;
    expect(within(first).getByText("Based on:")).toBeTruthy();
    expect(within(first).getByText("These 5 cancel soon; a reminder may help.")).toBeTruthy();
    expect(within(first).getByText("High confidence")).toBeTruthy();
    expect(within(first).getByRole("link", { name: /Open Payments/ }).getAttribute("href")).toBe("/payments");
    // No AI note: the rule's own next step, labelled as such.
    const second = screen.getByText(stock.headline).closest("li")!;
    expect(within(second).getByText("The rule's suggested next step.")).toBeTruthy();
  });

  it("filters by category", () => {
    render(<InsightGrid initial={[card(), stock]} days={7} answers={{}} enoughData />);
    fireEvent.click(screen.getByRole("tab", { name: /Stock/ }));
    expect(screen.queryByText(card().headline)).toBeNull();
    expect(screen.getByText(stock.headline)).toBeTruthy();
  });

  it("has a Feedback tab, which a ?category=feedback link opens", () => {
    const low = card({ key: "feedback:low:halaya", category: "feedback", module: "Feedback", headline: "Low ratings on Halaya: 3 of 8" });
    render(<InsightGrid initial={[card(), low]} days={7} answers={{}} enoughData initialTab={tabFor("feedback")} />);
    expect(screen.getByRole("tab", { name: /Feedback/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(low.headline)).toBeTruthy();
    expect(screen.queryByText(card().headline)).toBeNull();
    expect(tabFor("nonsense")).toBe("all");
    expect(tabFor(undefined)).toBe("all");
  });

  it("dismisses at once and puts the card back with the reason when the server refuses", async () => {
    let refuse!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => { refuse = r; }));
    render(<InsightGrid initial={[card()]} days={7} answers={{}} enoughData />);
    fireEvent.click(screen.getByRole("button", { name: `Dismiss for me: ${card().headline}` }));
    expect(screen.queryByText(card().headline)).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "dismiss", days: 7, key: "payments:expiring" });
    await act(async () => refuse(new Response(JSON.stringify({ ok: false, reason: "This insight has been updated. Reload the page to see the latest." }), { status: 409 })));
    expect(screen.getByText(card().headline)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("This insight has been updated");
  });

  it("opens the Evidence drawer with a loading state, then the records, and rolls back a refused answer", async () => {
    let records!: (r: Response) => void;
    fetchMock.mockImplementation((url: string) => url.includes("/evidence")
      ? new Promise((r) => { records = r; })
      : reply(500, { ok: false, reason: "Could not save that. Please try again." }));
    render(<InsightGrid initial={[card()]} days={30} answers={{}} enoughData />);
    fireEvent.click(screen.getByRole("button", { name: "See evidence" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("status", { name: "Loading the records" })).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/dashboard/ai-insights/evidence?days=30&key=payments%3Aexpiring");
    expect(within(drawer).getByText("Listed the unpaid Orders.")).toBeTruthy();
    expect(within(drawer).getByText(card().confidenceReason)).toBeTruthy();

    await act(async () => records(new Response(JSON.stringify({ ok: true, records: [
      { type: "order", id: 7, label: "Order #7", detail: "Maria Santos · Pasig", status: "Confirmed", href: "/orders/7" },
    ] }))));
    expect(within(drawer).getByRole("link", { name: /Order #7/ }).getAttribute("href")).toBe("/orders/7");
    expect(within(drawer).getByText("The 1 record")).toBeTruthy();

    const helpful = within(drawer).getByRole("button", { name: "Helpful" });
    fireEvent.click(helpful);
    expect(helpful.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(helpful.getAttribute("aria-pressed")).toBe("false"));
    expect(within(drawer).getByRole("alert").textContent).toContain("Couldn't save your answer");
  });

  it("with too little data shows the empty state with Open Dashboard and Open Reports", () => {
    render(<InsightGrid initial={[]} days={7} answers={{}} enoughData={false} />);
    expect(screen.getByText("No insights yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Dashboard/ }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("link", { name: /Open Reports/ })).toBeNull();
    expect(screen.getByText("Waiting for more orders")).toBeTruthy();
  });
});

describe("brief and stat row", () => {
  it("shows dashes and the not-enough-data note", () => {
    render(<><Brief days={7} summary={null} confidence={null} enoughData={false} orders={12} stats={emptyStats()} /><StatRow stats={emptyStats()} /></>);
    expect(screen.getByText(/12 in the last 7 days/)).toBeTruthy();
    expect(screen.getByText("Not enough data")).toBeTruthy();
    expect(screen.getAllByText("—")).toHaveLength(6);
  });
});

describe("the map", () => {
  const cityOf = (key: string, name: string, orders: number) => ({
    key, name, province: "metro manila", orders, previousOrders: 2, wentOut: orders, lateOrFailed: 1, previousWentOut: 2,
    previousLateOrFailed: 0, returned: 0, complaints: 1, deliveries: orders, freeDelivery: 1,
  });
  const areas: AreaFigures[] = [{
    ...cityOf("metro manila", "Metro Manila", 26), cities: [cityOf("metro manila|quezon", "Quezon City", 17), cityOf("metro manila|pasig", "Pasig", 9)],
  }];
  const viewBox = () => document.querySelector("svg[role=img]")!.getAttribute("viewBox");
  const box = (v: { x: number; y: number; w: number; h: number }) => `${v.x} ${v.y} ${v.w} ${v.h}`;

  it("opens on Metro Manila with city bubbles, zooms with the buttons, and shows province shading for the whole country", () => {
    render(<AreaSection areas={areas} unmapped={0} orders={40} days={7} enoughData />);
    expect(viewBox()).toBe(box(VIEWS["metro-manila"]));
    expect(document.querySelectorAll("[data-bubble]")).toHaveLength(2);
    expect(screen.getByText("Quezon City · 17")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(Number(viewBox()!.split(" ")[2])).toBeLessThan(VIEWS["metro-manila"].w);

    fireEvent.click(screen.getByRole("button", { name: "Philippines" }));
    expect(viewBox()).toBe(box(VIEWS.philippines));
    expect(document.querySelectorAll("[data-bubble]")).toHaveLength(0);
    expect(document.querySelector('[data-area="metro manila"]')!.getAttribute("fill")).not.toBe("#f3f1f6");

    fireEvent.click(screen.getByRole("button", { name: "Reset the map" }));
    expect(viewBox()).toBe(box(VIEWS["metro-manila"]));
  });

  it("switches layers and ranks the top areas with their change", () => {
    render(<AreaSection areas={areas} unmapped={0} orders={40} days={7} enoughData />);
    fireEvent.click(screen.getByRole("radio", { name: "Complaints" }));
    expect(screen.getByText("Quezon City · 1")).toBeTruthy();
    const top = screen.getByRole("region", { name: "Top areas" });
    expect(within(top).getAllByRole("listitem")[0].textContent).toContain("Quezon City");
    expect(within(top).getByText("+750%")).toBeTruthy();
    fireEvent.click(within(top).getAllByRole("button", { name: /Pasig/ })[0]);
    expect(within(top).getByRole("heading", { name: "Pasig" })).toBeTruthy();
  });

  const product = (over: Partial<ProductFigures>): ProductFigures => ({
    scope: "all", place: null, product: "Ube Jam", size: null, units: 0, previousUnits: 0, value: 0, orders: 1, previousOrders: 0,
    ratings: 0, ratingTotal: 0, ...over,
  });
  const products: ProductFigures[] = [
    product({ product: "Ube Jam", units: 20, previousUnits: 10, value: 300000, orders: 12, ratings: 3, ratingTotal: 12 }),
    product({ product: "Halaya", units: 8, value: 400000, orders: 8, ratings: 3, ratingTotal: 15 }),
    product({ product: "Ube Jam", size: "250 g", units: 15, orders: 10 }),
    product({ product: "Ube Jam", size: "500 g", units: 5, orders: 3 }),
    product({ scope: "city", place: "metro manila|quezon", product: "Halaya", units: 6, orders: 6 }),
    product({ scope: "city", place: "metro manila|quezon", product: "Ube Jam", units: 2, orders: 2 }),
    product({ scope: "city", place: "metro manila|pasig", product: "Ube Jam", units: 9, orders: 5 }),
    product({ scope: "province", place: "metro manila", product: "Ube Jam", units: 11, orders: 7 }),
  ];

  it("ranks every product, switching the metric and counting sizes apart", () => {
    render(<AreaSection areas={areas} unmapped={0} orders={40} days={7} enoughData products={products} canSeeRatings />);
    const top = screen.getByRole("region", { name: "Top products" });
    const first = () => within(top).getAllByRole("listitem")[0].textContent;
    expect(first()).toContain("Ube Jam");
    expect(within(top).getByText("+100%")).toBeTruthy();
    fireEvent.click(within(top).getByRole("radio", { name: "Sales value" }));
    expect(first()).toContain("Halaya");
    expect(first()).toContain("₱4,000");
    fireEvent.click(within(top).getByRole("radio", { name: "Rating" }));
    expect(first()).toContain("5.0 ★ (3)");
    fireEvent.click(within(top).getByRole("radio", { name: "Units sold" }));
    fireEvent.click(within(top).getByRole("radio", { name: "Product + size" }));
    expect(within(top).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Ube Jam 250 g"), expect.stringContaining("Ube Jam 500 g")]);
  });

  it("sits above the map and pages the ranking 5 at a time, back to page 1 when the ranking changes", () => {
    const many = Array.from({ length: 12 }, (_, i) => product({ product: `Product ${String(i + 1).padStart(2, "0")}`, units: 100 - i }));
    render(<AreaSection areas={areas} unmapped={0} orders={40} days={7} enoughData products={many} />);
    const top = screen.getByRole("region", { name: "Top products" });
    const map = screen.getByRole("region", { name: "Where it's happening" });
    expect(top.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = () => within(top).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows()).toHaveLength(5);
    expect(rows()[0]).toContain("1Product 01");
    expect(within(top).getByText("1–5 of 12")).toBeTruthy();
    expect((within(top).getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(top).getByRole("button", { name: "Next page" }));
    expect(rows()[0]).toContain("6Product 06");
    fireEvent.click(within(top).getByRole("button", { name: "Next page" }));
    expect(rows()).toHaveLength(2);
    expect(within(top).getByText("11–12 of 12")).toBeTruthy();
    expect((within(top).getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(top).getByRole("radio", { name: "Sales value" }));
    expect(within(top).getByText("Page 1 of 3")).toBeTruthy();
  });

  it("shows each area's favourite product, by city or by province, and an area's own ranking", () => {
    render(<AreaSection areas={areas} unmapped={0} orders={40} days={7} enoughData products={products} />);
    const top = screen.getByRole("region", { name: "Top areas" });
    const items = () => within(within(top).getAllByRole("list")[0]).getAllByRole("listitem").map((li) => li.textContent);
    expect(items()[0]).toContain("Favourite: Halaya");
    expect(items()[1]).toContain("Favourite: Ube Jam");
    fireEvent.click(within(top).getByRole("radio", { name: "Province" }));
    expect(items()).toEqual([expect.stringContaining("Metro Manila")]);
    expect(items()[0]).toContain("Favourite: Ube Jam");
    fireEvent.click(within(top).getByRole("radio", { name: "City" }));
    fireEvent.click(within(top).getAllByRole("button", { name: /Quezon City/ })[0]);
    const favourites = within(top).getByRole("heading", { name: "Favourite products" }).parentElement!;
    expect(within(favourites).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Halaya"), expect.stringContaining("Ube Jam")]);
  });

  it("hides the Rating ranking without the Feedback Module, and waits for the next run when the stored run has no products", () => {
    const { unmount } = render(<AreaSection areas={areas} unmapped={0} orders={40} days={7} enoughData products={products} />);
    expect(within(screen.getByRole("region", { name: "Top products" })).queryByRole("radio", { name: "Rating" })).toBeNull();
    unmount();
    render(<AreaSection areas={areas} unmapped={0} orders={40} days={7} enoughData />);
    expect(screen.getByText(/Product rankings show after the next morning run/)).toBeTruthy();
  });

  it("with too little data says so on the map and ranks nothing", () => {
    render(<AreaSection areas={areas} unmapped={0} orders={12} days={7} enoughData={false} />);
    expect(screen.getByText("Not enough orders to draw the map")).toBeTruthy();
    expect(document.querySelectorAll("[data-bubble]")).toHaveLength(0);
    expect(screen.getByText(/No areas to rank yet/)).toBeTruthy();
  });
});
