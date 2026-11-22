import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Raw <img> is allowed only where the image is not a photo to inspect. */
const ALLOWED = [
  "components/zoomable-image.tsx",
  "components/image-viewer.tsx",
  "components/brand/brand-lockup.tsx",
  "components/loading/loading-card.tsx",
  "features/dashboard/export-button.tsx",
  "features/tickets/summary-card.tsx",
  // A picked file that is not sent yet, with its own Remove button.
  "features/tickets/ticket-controls.tsx",
  "features/orders/delivery-photo-picker.tsx",
  // The chat opens its own multi-image viewer, and Senior/PWD opens front and back together.
  "features/tickets/message-attachment.tsx",
  "features/senior-pwd/check-detail.tsx",
];

describe("every photo can be clicked to zoom", () => {
  it("uses ZoomableImage instead of a raw <img> for photos", () => {
    const offenders = globSync("{features,components,app}/**/*.tsx")
      .filter((file) => !ALLOWED.includes(file))
      .filter((file) => /<img[\s>]/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
