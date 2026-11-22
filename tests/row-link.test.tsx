// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ABOVE_ROW_LINK, CLICKABLE_ROW, RowLink, rowButton } from "@/components/shared/row-link";

afterEach(cleanup);

describe("a clickable row", () => {
  it("is a real link whose overlay covers the row, with inner controls kept above it", () => {
    const act = vi.fn();
    render(
      <div data-testid="row" className={CLICKABLE_ROW}>
        <RowLink href="/orders/7">#7</RowLink>
        <button type="button" className={ABOVE_ROW_LINK} onClick={act}>Claim</button>
      </div>,
    );
    const link = screen.getByRole("link", { name: "#7" });
    expect(link.getAttribute("href")).toBe("/orders/7");
    expect(link.className).toContain("after:absolute");
    expect(link.className).toContain("after:inset-0");
    expect(screen.getByTestId("row").className).toContain("relative");
    expect(screen.getByRole("button", { name: "Claim" }).className).toContain("z-10");
    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    expect(act).toHaveBeenCalledOnce();
  });
});

describe("a row that opens a drawer or dialog", () => {
  it("opens on a click or Enter, but not when an inner button is clicked", () => {
    const open = vi.fn();
    const inner = vi.fn();
    render(
      <div {...rowButton(open, "Open Halaya")}>
        <span>Halaya</span>
        <button type="button" onClick={inner}>Edit</button>
      </div>,
    );
    const row = screen.getByRole("button", { name: "Open Halaya" });
    fireEvent.click(screen.getByText("Halaya"));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(inner).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
