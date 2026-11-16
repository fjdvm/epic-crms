// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComplaintThemesView } from "@/features/feedback/themes-view";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/features/feedback/themes-client", () => ({ loadComplaintThemes: load }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const made = (themes: unknown[], extra = {}) => ({ unavailable: false, themes: { period: { from: null, to: null }, themes, ticketsRead: 38, returnsRead: 6,
  feedbackRead: 51, itemsAvailable: 95, truncated: false, model: "m", sentText: "T1: leaks", systemPrompt: "", createdAt: "2026-11-14T02:42:00Z", ...extra } });
const theme = { label: "Leaking lid", count: 3, items: [
  { id: "T1", source: "ticket", recordId: 1, href: "/tickets/1" }, { id: "R2", source: "return", recordId: 2, href: "/returns/2" }, { id: "F3", source: "feedback", recordId: 3, href: "/orders/3" }] };

describe("ComplaintThemesView", () => {
  it("shows the loading state at once, then counts and working links", async () => {
    load.mockResolvedValue(made([theme]));
    render(<ComplaintThemesView canRefresh />);
    expect(screen.getByRole("status", { name: "Loading Complaint themes" })).toBeTruthy();
    expect(await screen.findByText("Leaking lid")).toBeTruthy();
    expect(screen.getByText("3 mentions")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ticket #1" }).getAttribute("href")).toBe("/tickets/1");
    expect(screen.getByRole("link", { name: "Return #2" }).getAttribute("href")).toBe("/returns/2");
    expect(screen.getByRole("link", { name: "Feedback · Order #3" }).getAttribute("href")).toBe("/orders/3");
    expect(screen.getByText(/from 38 tickets, 6 returns and 51 feedback/)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("says so when nothing qualifies", async () => {
    load.mockResolvedValue(made([]));
    render(<ComplaintThemesView canRefresh />);
    expect(await screen.findByText("No repeated complaints in this period")).toBeTruthy();
  });
  it("shows a failure message and stays usable", async () => {
    load.mockResolvedValue({ themes: null, unavailable: true });
    render(<ComplaintThemesView canRefresh />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/unavailable right now/);
  });
  it("Refresh shows loading, asks for a refresh once, and keeps the old result when it fails", async () => {
    load.mockResolvedValueOnce(made([theme]));
    render(<ComplaintThemesView from="2026-11-01" to="2026-11-10" canRefresh />);
    await screen.findByText("Leaking lid");
    let finish!: (v: unknown) => void;
    load.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("status", { name: "Loading Complaint themes" })).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith({ from: "2026-11-01", to: "2026-11-10" }, true);
    await act(async () => finish({ themes: null, unavailable: true }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/earlier result/));
    expect(screen.getByText("Leaking lid")).toBeTruthy();
  });
  it("gives Admin and CEO the kept result with no Refresh, and a plain note when none is kept", async () => {
    load.mockResolvedValue({ themes: null, unavailable: true });
    render(<ComplaintThemesView canRefresh={false} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/No Complaint themes have been made/);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });
});
