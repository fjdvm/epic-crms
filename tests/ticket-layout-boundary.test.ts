import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CELL, COLUMNS, HEAD } from "@/features/tickets/ticket-layout";

const read = (path: string) => readFileSync(path, "utf8");

describe("the Tickets list layout", () => {
  it("is plain values the server-rendered list can read", () => {
    expect(Array.isArray(COLUMNS)).toBe(true);
    expect(COLUMNS.map((c) => c.header)).toContain("Details");
    expect(typeof HEAD).toBe("string");
    expect(typeof CELL).toBe("string");
  });

  // Production error "COLUMNS.map is not a function": a server component imported COLUMNS from a "use client" module,
  // where it arrives as a client reference and not an array. Vitest cannot see that boundary, so check it here.
  it("does not live in a client module that the server list imports from", () => {
    expect(read("features/tickets/ticket-layout.ts")).not.toMatch(/^"use client"/);
    expect(read("features/tickets/ticket-rows.tsx")).toMatch(/^"use client"/);

    const list = read("features/tickets/ticket-list.tsx");
    expect(list).not.toMatch(/^"use client"/);
    expect(list).not.toMatch(/import \{[^}]*\b(COLUMNS|HEAD|CELL)\b[^}]*\} from "\.\/ticket-rows"/);
  });
});
