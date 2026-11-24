// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { InsightTabs } from "@/features/ai-insights/insight-tabs";
import { busiest, formatHours, OperationsPanel, OrdersPanel, PanelSkeleton, PaymentsPanel } from "@/features/ai-insights/panels";
import { SuggestionCards } from "@/features/ai-insights/suggestion-cards";
import type { Suggestion } from "@/features/ai-insights/suggestions";

const card = (key: string, f: Partial<Suggestion> = {}): Suggestion => ({
  key, module: "Payments", numbers: { orders: 3 }, text: `Text ${key}`, action: { label: "Open Payments", href: "/payments" }, urgency: 1, why: "Kept why.", ...f,
});
const ok = (body: object, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("SuggestionCards", () => {
  it("dismisses at once and keeps it gone when the server agrees", async () => {
    fetchMock.mockReturnValue(ok({ ok: true }));
    render(<SuggestionCards initial={[card("a"), card("b")]} canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: Text a" }));
    expect(screen.queryByText("Text a")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ key: "a", numbers: { orders: 3 }, decision: "dismissed" });
    expect(screen.getByText("Text b")).toBeTruthy();
  });

  it("puts a dismissed card back and says why when the server refuses", async () => {
    fetchMock.mockReturnValue(ok({ ok: false, reason: "This suggestion changed or no longer applies. Reload the page to see the latest." }, 409));
    render(<SuggestionCards initial={[card("a")]} canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: Text a" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This suggestion changed or no longer applies. Reload the page to see the latest.");
    expect(screen.getByText("Text a")).toBeTruthy();
  });

  it("says to check the connection when the dismissal cannot be sent", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SuggestionCards initial={[card("a")]} canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: Text a" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not dismiss this suggestion. Check your connection and try again.");
    expect(screen.getByText("Text a")).toBeTruthy();
  });

  it("waits for the server with a spinner before opening the screen on accept", async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { answer = r; }));
    render(<SuggestionCards initial={[card("a")]} canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Open Payments" }));
    expect(screen.getByRole("button", { name: "Open Payments" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Text a")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    await act(async () => answer(new Response(JSON.stringify({ ok: true, href: "/payments" }))));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/payments"));
  });

  it("asks for a missing why only for a Manager, and shows it when it comes", async () => {
    fetchMock.mockReturnValue(ok({ why: "Because." }));
    render(<SuggestionCards initial={[card("a", { why: null })]} canDecide />);
    expect(screen.getByRole("status", { name: "Loading why it matters" })).toBeTruthy();
    expect(await screen.findByText("Because.")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/dashboard/ai-insights/explain");
  });

  it("is view-only for Admin: plain links, no Dismiss, no model call, no Manager-only action", () => {
    render(<SuggestionCards initial={[card("a", { why: null }), card("b", { action: { label: "Open Commerce Settings", href: "/management/commerce-settings", managerOnly: true } })]} canDecide={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Dismiss/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Payments" }).getAttribute("href")).toBe("/payments");
    expect(screen.queryByText("Open Commerce Settings")).toBeNull();
  });

  it("says when there is nothing to suggest", () => {
    render(<SuggestionCards initial={[]} canDecide />);
    expect(screen.getByText("No suggestions right now.")).toBeTruthy();
  });
});

describe("insight panels", () => {
  it("formats hours and finds the busiest hour", () => {
    expect([formatHours(null), formatHours(0.25), formatHours(5.25), formatHours(72)]).toEqual(["–", "15 min", "5.3 h", "3 days"]);
    const peak = Array.from({ length: 7 }, () => Array(24).fill(0));
    peak[5][19] = 4;
    expect(busiest(peak)).toEqual({ day: 5, hour: 19, count: 4 });
  });

  it("shows how far Orders got and the busiest time", () => {
    const peak = Array.from({ length: 7 }, () => Array(24).fill(0));
    peak[5][19] = 4;
    render(<OrdersPanel data={{
      funnel: [{ key: "placed", count: 10, medianHours: null }, { key: "paid", count: 8, medianHours: 2 }, { key: "handedOver", count: 6, medianHours: 30 }, { key: "delivered", count: 5, medianHours: null }],
      cancelled: 1, peak, cancelReasons: [], failedReasons: [{ label: "Not home", count: 2 }], pairs: [],
    }} />);
    expect(screen.getByText("8 · 80%")).toBeTruthy();
    expect(screen.getByText("half within 2 h")).toBeTruthy();
    expect(screen.getByText("Busiest: Fri around 7pm (4 Orders)")).toBeTruthy();
    expect(screen.getByText("No cancellations in this period")).toBeTruthy();
    expect(screen.getByText("Not home")).toBeTruthy();
  });

  it("shows payment figures with labelled methods", () => {
    render(<PaymentsPanel data={{
      methods: [{ method: "gcash", orders: 4, sales: 40000, previousOrders: 2 }],
      verify: { orders: 4, medianHours: 3, slowestHours: 10, weekdayMedianHours: 2, weekendMedianHours: null },
      proofs: { submitted: 5, rejected: 1, reusedReference: 0 },
      unpaid: [{ key: "under-1-day", orders: 1, value: 1000 }, { key: "1-to-3-days", orders: 0, value: 0 }, { key: "over-3-days", orders: 2, value: 5000 }],
      refunds: { count: 0, amount: 0, reasons: [] }, nearFreeDelivery: { orders: 1, eligible: 4 },
    }} />);
    expect(screen.getByText("GCash")).toBeTruthy();
    expect(screen.getByText("4 Orders · ₱400.00 · ▲ 100%")).toBeTruthy();
    expect(screen.getByText("1 (20%)")).toBeTruthy();
    expect(screen.getByText(/25% of the 4 Orders that paid a Delivery fee/)).toBeTruthy();
  });

  it("shows only the operations sections the person's Modules allow", () => {
    render(<OperationsPanel data={null} stock={[{ name: "Ube Jam (250g)", available: 6, soldPerDay: 2, daysLeft: 3 }]}
      show={{ fulfilment: false, returns: false, tickets: false, feedback: false, stock: true }} />);
    expect(screen.getByText("6 left · ~3 days")).toBeTruthy();
    expect(screen.getByText(/Couldn't load these figures/)).toBeTruthy();
  });

  it("has a loading state to show at once", () => {
    render(<PanelSkeleton />);
    expect(screen.getByRole("status", { name: "Loading figures" })).toBeTruthy();
  });

  it("switches tabs at once, keeping every panel on the page", () => {
    render(<InsightTabs tabs={[{ value: "a", label: "Orders", content: <p>Orders panel</p> }, { value: "b", label: "Payments", content: <p>Payments panel</p> }]} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Payments" }));
    expect(screen.getByRole("tab", { name: "Payments" }).getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("tabpanel", { name: "Payments" })).getByText("Payments panel")).toBeTruthy();
    expect(screen.getByText("Orders panel").closest("[role=tabpanel]")?.getAttribute("data-state")).toBe("inactive");
  });
});
