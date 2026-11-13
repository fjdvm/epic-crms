// @vitest-environment jsdom
import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PeriodNavigation, PeriodPicker } from "@/features/dashboard/period-navigation";

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
      <Suspense fallback={<div role="status" aria-label="Loading Sales" />}>
        <p>₱1,000</p>
      </Suspense>
    </PeriodNavigation>
  );
}

describe("the Dashboard period picker", () => {
  it("highlights the clicked period at once without replacing rendered figures with skeletons", async () => {
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
    expect(screen.queryByRole("status", { name: "Loading Sales" })).toBeNull();
    expect(screen.getByText("₱1,000")).toBeTruthy();
  });
});
