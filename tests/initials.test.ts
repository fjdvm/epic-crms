import { describe, expect, it } from "vitest";

import { initials } from "@/features/tickets/initials";

describe("avatar initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("Paolo Dizon")).toBe("PD");
    expect(initials("maria  de la Cruz")).toBe("MD");
    expect(initials("Madonna")).toBe("M");
    expect(initials("")).toBe("");
  });

  it("lives in a module with no 'use client', so server components can call it", async () => {
    const { readFile } = await import("node:fs/promises");

    expect(await readFile("features/tickets/initials.ts", "utf8")).not.toMatch(/use client/);
  });
});
