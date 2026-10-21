import { describe, expect, it } from "vitest";

import { bandsOf, defaultLayout, IMAGE_LAYOUTS, layoutsFor } from "@/features/marketing/image-layouts";

describe("the image layouts offered for a number of images", () => {
  it("offers nothing when there are no images", () => {
    expect(layoutsFor(0)).toEqual([]);
  });

  it("offers one layout for a single image", () => {
    expect(layoutsFor(1)).toEqual(["single"]);
  });

  it.each([
    [2, ["two-columns", "two-rows", "stacked"]],
    [3, ["three-feature-left", "three-feature-top", "three-row", "stacked"]],
    [4, ["four-grid", "four-feature-left", "four-feature-top", "stacked"]],
  ])("offers collages that hold exactly %i images, and stacked", (count, expected) => {
    expect(layoutsFor(count)).toEqual(expected);
  });

  it("offers only stacked from five images, where no collage holds them all", () => {
    expect(layoutsFor(5)).toEqual(["stacked"]);
    expect(layoutsFor(12)).toEqual(["stacked"]);
  });

  it("defaults to the first layout offered", () => {
    expect(defaultLayout(1)).toBe("single");
    expect(defaultLayout(3)).toBe("three-feature-left");
    expect(defaultLayout(6)).toBe("stacked");
    expect(defaultLayout(0)).toBeNull();
  });

  it("knows every layout it offers", () => {
    for (const count of [1, 2, 3, 4, 5]) for (const layout of layoutsFor(count)) expect(IMAGE_LAYOUTS).toContain(layout);
  });
});

describe("how a layout places its images", () => {
  it("has a tile for each image, in reading order, for every collage", () => {
    for (const layout of IMAGE_LAYOUTS) {
      if (layout === "stacked") continue;

      const tiles = bandsOf(layout)!.flat(2);
      expect(tiles.length).toBeGreaterThan(0);
      expect(layoutsFor(tiles.length)).toContain(layout);
    }
  });

  it("has no bands for stacked, which is every image full width", () => {
    expect(bandsOf("stacked")).toBeNull();
  });
});
