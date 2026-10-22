// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SigningIn } from "@/components/loading/signing-in";
import { SidebarEnterpriseHeader } from "@/components/layout/sidebar-enterprise-header";
import { SidebarProfileFooter } from "@/components/layout/sidebar-profile-footer";
import { StaffProvider } from "@/components/layout/staff-context";
import AppLoading from "@/app/(app)/loading";
import CustomerProfilesLoading from "@/app/(app)/customer-profiles/loading";
import CustomerProfileLoading from "@/app/(app)/customer-profiles/[id]/loading";
import FeedbackLoading from "@/app/(app)/feedback/loading";
import TicketsLoading from "@/app/(app)/tickets/loading";
import TicketLoading from "@/app/(app)/tickets/[id]/loading";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the sign-in handoff loading card", () => {
  it("starts the handoff straight away but shows nothing before the wait passes about 300 ms", () => {
    const navigate = vi.fn();
    render(<SigningIn loginUrl="/api/portal/login?returnTo=%2Ftickets" navigate={navigate} />);

    act(() => void vi.advanceTimersByTime(299));

    expect(navigate).toHaveBeenCalledWith("/api/portal/login?returnTo=%2Ftickets");
    expect(screen.queryByText("Opening CRMS…")).toBeNull();
  });

  it("shows the opening CRMS card once the wait passes 300 ms", () => {
    render(<SigningIn loginUrl="/api/portal/login" navigate={vi.fn()} />);

    act(() => void vi.advanceTimersByTime(300));

    expect(screen.getByText("Opening CRMS…")).toBeTruthy();
    expect(screen.getByText("Handing your sign-in over securely")).toBeTruthy();
  });
});

const pageLoadings = [
  ["any CREOMS page", AppLoading],
  ["Customer Profiles", CustomerProfilesLoading],
  ["a Customer profile", CustomerProfileLoading],
  ["Feedback", FeedbackLoading],
  ["Tickets", TicketsLoading],
  ["a Ticket", TicketLoading],
] as const;

describe("the page navigation skeleton", () => {
  it.each(pageLoadings)("shows a skeleton straight away, not the loading card, on %s", (_page, Loading) => {
    render(<Loading />);

    expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();
    expect(screen.queryByText("Getting this page ready")).toBeNull();
  });
});

describe("the return to the Portal loading card", () => {
  function openLogOut() {
    render(
      <StaffProvider
        staff={{ name: "Ada Okafor", username: "ada.okafor", email: "ada@brenraphaels.test", role: "Customer Support" }}
      >
        <SidebarProfileFooter />
      </StaffProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  }

  function confirmLogOut() {
    document.addEventListener("submit", (event) => event.preventDefault(), { once: true });
    const confirm = screen.getAllByRole("button", { name: "Log out" }).find((b) => b.getAttribute("form") === "logout-form")!;
    fireEvent.click(confirm);
  }

  it("never shows the card while the Log out dialog is only open", () => {
    openLogOut();

    act(() => void vi.advanceTimersByTime(1000));

    expect(screen.queryByText("Returning to the Portal…")).toBeNull();
  });

  it("shows nothing before the wait passes about 300 ms after Log out is confirmed", () => {
    openLogOut();
    confirmLogOut();

    act(() => void vi.advanceTimersByTime(299));

    expect(screen.queryByText("Returning to the Portal…")).toBeNull();
  });

  it("shows the returning to the Portal card once the wait passes 300 ms", () => {
    openLogOut();
    confirmLogOut();

    act(() => void vi.advanceTimersByTime(300));

    expect(screen.getByText("Returning to the Portal…")).toBeTruthy();
    expect(screen.getByText("Signing you out securely")).toBeTruthy();
  });
});

describe("the return to the Portal loading card from the module switcher", () => {
  function chooseModule(name: string) {
    const navigate = vi.fn();
    render(<SidebarEnterpriseHeader isMobile={false} navigate={navigate} />);
    fireEvent.pointerDown(screen.getByText("Bren Raphael's"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(screen.getByText(name));

    return navigate;
  }

  it("goes to the Portal straight away but shows nothing before the wait passes about 300 ms", () => {
    const navigate = chooseModule("Enterprise Portal");

    act(() => void vi.advanceTimersByTime(299));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Returning to the Portal…")).toBeNull();
  });

  it("shows the returning to the Portal card once the wait passes 300 ms", () => {
    chooseModule("Enterprise Portal");

    act(() => void vi.advanceTimersByTime(300));

    expect(screen.getByText("Returning to the Portal…")).toBeTruthy();
    expect(screen.getByText("Opening the Enterprise Portal")).toBeTruthy();
  });

  it("shows no Portal card when another System is chosen", () => {
    chooseModule("Human Resource Management");

    act(() => void vi.advanceTimersByTime(1000));

    expect(screen.queryByText("Returning to the Portal…")).toBeNull();
  });
});
