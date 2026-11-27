// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadingImage } from "@/components/loading-image";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const logo = (container: HTMLElement) => container.querySelector("img[data-loading-image]");
const photo = () => screen.getByRole("img", { name: "Receipt" });

describe("LoadingImage", () => {
  it("shows the brand logo until the photo has loaded", () => {
    const onLoad = vi.fn();
    const { container } = render(<LoadingImage src="/a.png" alt="Receipt" onLoad={onLoad} />);
    expect(logo(container)?.getAttribute("src")).toBe("/images/brand/default-product.png");
    expect(photo().className).toContain("opacity-0");

    fireEvent.load(photo());
    expect(logo(container)).toBeNull();
    expect(photo().className).not.toContain("opacity-0");
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("drops the logo when the photo fails, so a failure never looks like loading", () => {
    const onError = vi.fn();
    const { container } = render(<LoadingImage src="/a.png" alt="Receipt" onError={onError} />);

    fireEvent.error(photo());
    expect(logo(container)).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("shows no logo for a photo that is already loaded", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const { container } = render(<LoadingImage src="/a.png" alt="Receipt" />);
    expect(logo(container)).toBeNull();
  });

  it("shows the logo again while a new photo loads", () => {
    const { container, rerender } = render(<LoadingImage src="/a.png" alt="Receipt" />);
    fireEvent.load(photo());

    rerender(<LoadingImage src="/b.png" alt="Receipt" />);
    expect(logo(container)).not.toBeNull();
  });
});
