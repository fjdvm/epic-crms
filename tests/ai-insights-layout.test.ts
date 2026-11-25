import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// app/globals.css defines --spacing-xs … --spacing-3xl (4px to 64px). Tailwind v4 resolves max-w-xs, max-w-md and the like
// from those first, so a "max-w-md" box is 16px wide and its text wraps one word per line. Use explicit sizes instead.
const NAMED_MAX_WIDTH = /\bmax-w-(xs|sm|md|lg|xl|2xl|3xl)\b/;

describe("AI insights layout", () => {
  it("never uses a named max-width, which the spacing scale shrinks to a few pixels", () => {
    const files = [
      ...readdirSync("features/ai-insights").filter((f) => f.endsWith(".tsx")).map((f) => `features/ai-insights/${f}`),
      "app/(app)/dashboard/ai-insights/page.tsx",
      "features/dashboard/export-button.tsx",
    ];
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(NAMED_MAX_WIDTH);
  });
});
