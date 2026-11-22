// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSearchInput, TicketToolbar } from "@/features/tickets/ticket-toolbar";

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/tickets",
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  vi.useFakeTimers();
  replace.mockReset();
  search = "";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const OPTIONS = { categories: ["Damaged item"], claimers: [{ id: "staff-2", name: "Rhea" }] };

describe("the Tickets toolbar", () => {
  it("puts the search in the address after a short pause in typing, starting from the first page", () => {
    search = "tab=resolved&page=3";
    render(<TicketToolbar options={OPTIONS} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Tickets" }), { target: { value: "maria" } });
    expect(replace).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(200));

    expect(replace).toHaveBeenCalledWith("/tickets?tab=resolved&q=maria");
  });

  it("asks once for what was typed, not for every keystroke", () => {
    render(<TicketToolbar options={OPTIONS} />);
    const box = screen.getByRole("searchbox", { name: "Search Tickets" });

    for (const value of ["m", "ma", "mar"]) fireEvent.change(box, { target: { value } });
    act(() => void vi.advanceTimersByTime(200));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/tickets?q=mar");
  });

  it("shows the search the address already holds", () => {
    search = "q=TKT-208";
    render(<TicketToolbar options={OPTIONS} />);

    expect((screen.getByRole("searchbox", { name: "Search Tickets" }) as HTMLInputElement).value).toBe("TKT-208");
  });

  it("toggles Overdue and keeps the rest of the filters", () => {
    search = "priority=high";
    render(<TicketToolbar options={OPTIONS} />);

    fireEvent.click(screen.getByRole("button", { name: "Overdue" }));

    expect(replace).toHaveBeenCalledWith("/tickets?priority=high&overdue=1");
  });

  it("toggles Escalated and keeps the rest of the filters", () => {
    search = "priority=high";
    render(<TicketToolbar options={OPTIONS} />);

    fireEvent.click(screen.getByRole("button", { name: "Escalated" }));

    expect(replace).toHaveBeenCalledWith("/tickets?priority=high&escalated=1");
  });

  it("has no Clear filters until something narrows the list, then clears search and filters but keeps the tab", () => {
    const { unmount } = render(<TicketToolbar options={OPTIONS} />);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    unmount();

    search = "tab=mine&q=maria&priority=high&claimed=unclaimed&overdue=1&category=Delivery";
    render(<TicketToolbar options={OPTIONS} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(replace).toHaveBeenCalledWith("/tickets?tab=mine");
  });

  it("has Priority, Category and Claimed by filters, the Escalated toggle, and no Channel", () => {
    render(<TicketToolbar options={OPTIONS} />);

    for (const name of ["Priority", "Category", "Claimed by"]) {
      expect(screen.getByRole("combobox", { name })).toBeTruthy();
    }
    expect(screen.queryByText(/channel/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Escalated" })).toBeTruthy();
  });
});

describe("the chat search", () => {
  it("drops the open chat from the address so the first match opens", () => {
    search = "ticket=208";
    render(<ChatSearchInput label="Search chats" placeholder="Search" />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), { target: { value: "ana" } });
    act(() => void vi.advanceTimersByTime(200));

    expect(replace).toHaveBeenCalledWith("/tickets?q=ana");
  });
});
