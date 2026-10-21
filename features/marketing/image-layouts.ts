/**
 * How an Announcement's images are arranged in the email, as in a social post: one layout per
 * Announcement, chosen by Staff from those that hold exactly the images it has.
 *
 * The geometry below must match the notifications service's marketing template (its `imageLayout`
 * field takes these same names), so the preview here looks like the email that is sent.
 */

/**
 * A layout is a list of bands (rows); a band is a list of columns, left to right; a column is a list
 * of tile heights in px, top to bottom, out of an email's 552 px content width. Images fill the tiles
 * band by band, column by column. A height of 0 keeps the image's own proportions.
 */
export type Bands = number[][][];

const COLLAGES = {
  single: [[[0]]],
  "two-columns": [[[272], [272]]],
  "two-rows": [[[276]], [[276]]],
  "three-feature-left": [[[360], [176, 176]]],
  "three-feature-top": [[[300]], [[180], [180]]],
  "three-row": [[[178], [178], [178]]],
  "four-grid": [
    [[200], [200]],
    [[200], [200]],
  ],
  "four-feature-left": [[[376], [120, 120, 120]]],
  "four-feature-top": [[[300]], [[140], [140], [140]]],
} satisfies Record<string, Bands>;

/** `stacked` is every image full width, one above the other, whatever their number. */
export const IMAGE_LAYOUTS = ["stacked", ...Object.keys(COLLAGES)] as ["stacked", ...(keyof typeof COLLAGES)[]];

export type ImageLayout = (typeof IMAGE_LAYOUTS)[number];

export const IMAGE_LAYOUT_LABELS: Record<ImageLayout, string> = {
  stacked: "Stacked",
  single: "Single image",
  "two-columns": "Two side by side",
  "two-rows": "Two stacked",
  "three-feature-left": "One large, two small",
  "three-feature-top": "Large on top, two below",
  "three-row": "Three in a row",
  "four-grid": "Four in a grid",
  "four-feature-left": "One large, three small",
  "four-feature-top": "Large on top, three below",
};

export const isImageLayout = (value: unknown): value is ImageLayout =>
  typeof value === "string" && (IMAGE_LAYOUTS as string[]).includes(value);

/** The tiles of a collage; null for `stacked`, which has no fixed number of tiles. */
export function bandsOf(layout: ImageLayout): Bands | null {
  return layout === "stacked" ? null : COLLAGES[layout];
}

const tilesIn = (layout: keyof typeof COLLAGES) => COLLAGES[layout].flat(2).length;

/** The layouts that suit this many images: the collages that hold exactly that many, then stacked. */
export function layoutsFor(count: number): ImageLayout[] {
  if (count < 1) return [];

  const collages = (Object.keys(COLLAGES) as (keyof typeof COLLAGES)[]).filter((layout) => tilesIn(layout) === count);

  // A single image stacked is the single layout; it is not offered twice.
  return count === 1 ? collages : [...collages, "stacked"];
}

export function defaultLayout(count: number): ImageLayout | null {
  return layoutsFor(count)[0] ?? null;
}
