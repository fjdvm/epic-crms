// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ZoomableImage } from "@/components/zoomable-image";

afterEach(cleanup);

describe("ZoomableImage", () => {
  it("opens the photo full screen on click, and closes with the X or Esc", () => {
    render(<ZoomableImage src="/a.png" alt="Receipt for Order #1" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Zoom Receipt for Order #1" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    // One photo: no counter and no thumbnail strip.
    expect(screen.queryByRole("button", { name: "Show image 1" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Zoom Receipt for Order #1" }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
