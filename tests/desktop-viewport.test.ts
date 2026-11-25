import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The owner wants the desktop site on every screen, phones included (2026-11-25).
// A fixed viewport width makes phones lay the page out at desktop width and zoom out to fit,
// so Tailwind breakpoints and useIsMobile() always see a desktop.
const layout = readFileSync("app/layout.tsx", "utf8");

describe("desktop layout everywhere", () => {
  it("sets a fixed desktop viewport width in the root layout", () => {
    expect(layout).toMatch(/const DESKTOP_WIDTH = 1280;/);
    expect(layout).toMatch(/export const viewport: Viewport = \{\s*width: DESKTOP_WIDTH,/);
    // Overrides Next.js's default initial-scale=1 so phones open zoomed out to the full width.
    expect(layout).toMatch(/^\s*initialScale: undefined,$/m);
  });

  it("never falls back to device-width or blocks pinch-zoom", () => {
    expect(layout).not.toMatch(/device-width/);
    expect(layout).not.toMatch(/userScalable|maximumScale|minimumScale/);
  });

  it("keeps the body at desktop width for browsers that ignore the viewport tag", () => {
    expect(layout).toMatch(/<body className="[^"]*\bmin-w-\[1280px\]/);
  });
});
