// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SigningIn } from "@/components/loading/signing-in";

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
