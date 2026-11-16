// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryCard } from "@/features/tickets/summary-card";
import { loadTicketSummary } from "@/features/tickets/summary-action";
import type { SummaryResult } from "@/features/tickets/summary-view";

vi.mock("@/features/tickets/summary-action", () => ({ loadTicketSummary: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const kept: SummaryResult = { unavailable: false, summary: {
  text: "The Customer reports a leaking pouch.", model: "fake", sentText: "Subject: Leaking pouch\nCustomer: It leaks.",
  systemPrompt: "Summarise the Ticket.", createdAt: "2026-11-16T01:00:00Z",
} };

describe("Ticket summary card", () => {
  it("shows a skeleton at once, then the AI-written summary and exact inputs; replay and rerenders do not call again", async () => {
    let resolve!: (r: SummaryResult) => void;
    vi.mocked(loadTicketSummary).mockReturnValue(new Promise((r) => { resolve = r; }));
    const view = render(<StrictMode><SummaryCard ticketId={1} /></StrictMode>);
    expect(screen.getByRole("status", { name: "Loading Ticket summary" })).toBeTruthy();
    expect(loadTicketSummary).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(kept); });
    expect(screen.getByText("AI-written")).toBeTruthy();
    expect(screen.getByText(kept.summary!.text)).toBeTruthy();
    fireEvent.click(screen.getByText("What the AI saw"));
    expect(screen.getByText("Subject: Leaking pouch Customer: It leaks.")).toBeTruthy();
    expect(screen.getByText("Summarise the Ticket.")).toBeTruthy();
    view.rerender(<StrictMode><SummaryCard ticketId={1} /></StrictMode>);
    fireEvent.focus(window);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(loadTicketSummary).toHaveBeenCalledTimes(1);
  });
  it("shows a plain unavailable message on server or transport failure while preserving an earlier summary", async () => {
    vi.mocked(loadTicketSummary).mockResolvedValue({ ...kept, unavailable: true });
    const view = render(<SummaryCard ticketId={1} />);
    expect(await screen.findByText(/Showing the earlier summary below/)).toBeTruthy();
    expect(screen.getByText(kept.summary!.text)).toBeTruthy();
    vi.mocked(loadTicketSummary).mockRejectedValue(new Error("offline"));
    view.rerender(<SummaryCard key={2} ticketId={2} />);
    expect(await screen.findByText(/You can keep working by hand/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Ticket summary" })).queryByText(kept.summary!.text)).toBeNull();
  });
});
