// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

import { ReturnFlagNotes } from "@/features/returns/return-flag-notes";

describe("ReturnFlagNotes", () => {
  it("names the rule and links each earlier Return", () => {
    render(<ReturnFlagNotes flags={[
      { rule: "similar-photo", text: "An evidence photo looks like one already used on another Return.", earlier: [{ id: 4, number: "RMA-4" }] },
      { rule: "frequent-returns", text: "This Customer has 3 Returns in the last 90 days.", earlier: [{ id: 2, number: "RMA-2" }, { id: 3, number: "RMA-3" }] },
    ]} />);
    expect(screen.getByText("Similar photo")).toBeTruthy();
    expect(screen.getByText("3+ Returns in 90 days")).toBeTruthy();
    expect(screen.getByRole("link", { name: "RMA-4" }).getAttribute("href")).toBe("/returns/4");
    expect(screen.getByRole("link", { name: "RMA-3" }).getAttribute("href")).toBe("/returns/3");
  });

  it("renders nothing without flags", () => {
    const { container } = render(<ReturnFlagNotes flags={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
