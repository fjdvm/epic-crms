// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PeriodNavigation, PeriodPicker, WhilePending } from "@/features/dashboard/period-navigation";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockReset();
});

function Page() {
  return (
    <PeriodNavigation preset="7-days">
      <PeriodPicker />
      <WhilePending fallback={<div role="status" aria-label="Loading Sales" />}>
        <p>₱1,000</p>
      </WhilePending>
    </PeriodNavigation>
  );
}

describe("the Dashboard period picker", () => {
  it("highlights the clicked period at once and shows skeletons until the new figures arrive", async () => {
    // The navigation never settles, as with a slow server.
    push.mockImplementation(() => new Promise(() => {}));
    render(<Page />);

    expect(screen.getByRole("link", { name: "7 days" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("₱1,000")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Last month" }));
    });

    expect(push).toHaveBeenCalledWith("/dashboard?period=last-month");
    expect(screen.getByRole("link", { name: "Last month" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: "7 days" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading Sales" })).toBeTruthy();
    expect(screen.queryByText("₱1,000")).toBeNull();
  });
});
