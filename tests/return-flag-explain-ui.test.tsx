// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReturnFlagNotes } from "@/features/returns/return-flag-notes";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const flags = [{ rule: "similar-photo" as const, text: "Looks like one already used.", earlier: [{ id: 4, number: "RMA-4" }] }];
const explain = (canExplain: boolean, kept = {}) => ({ returnId: 9, canExplain, kept });

describe("Explain this flag", () => {
  it("is offered to Managers only", () => {
    render(<ReturnFlagNotes flags={flags} explain={explain(false)} />);
    expect(screen.queryByRole("button", { name: "Explain this flag" })).toBeNull();
    cleanup();
    render(<ReturnFlagNotes flags={flags} explain={explain(true)} />);
    expect(screen.getByRole("button", { name: "Explain this flag" })).toBeTruthy();
  });

  it("is not in the list rows", () => {
    render(<ReturnFlagNotes flags={flags} compact />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a spinner at once, then the explanation labelled AI-written", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, explanation: "Two Returns in 30 days." }) }));
    render(<ReturnFlagNotes flags={flags} explain={explain(true)} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain this flag" }));
    expect(screen.getByRole("status")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Two Returns in 30 days.")).toBeTruthy());
    expect(screen.getByText(/AI-written/)).toBeTruthy();
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/returns/9/flag-explanation");
    expect(JSON.parse(init.body)).toEqual({ rule: "similar-photo" });
  });

  it("says why when it fails and leaves the flag as it was", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, reason: "unavailable" }) }));
    render(<ReturnFlagNotes flags={flags} explain={explain(true)} />);
    fireEvent.click(screen.getByRole("button", { name: "Explain this flag" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be written/));
    expect(screen.getByText("Similar photo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explain this flag" })).toBeTruthy();
  });

  it("shows a kept explanation without a button", () => {
    render(<ReturnFlagNotes flags={flags} explain={explain(false, { "similar-photo": "Kept text." })} />);
    expect(screen.getByText("Kept text.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
