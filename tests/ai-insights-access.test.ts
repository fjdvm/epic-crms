import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { canSeeAiInsights, shellPages } from "@/lib/portal/staff";

describe("AI Insights in the shell", () => {
  it("is added for Manager-level Roles and Admin who hold the Dashboard Module", () => {
    for (const role of ["CREOMS Manager", "General Manager", "CEO", "VP", "Admin"]) {
      expect(shellPages(["/dashboard"], role)).toContain("/dashboard/ai-insights");
      expect(canSeeAiInsights(role)).toBe(true);
    }
  });

  it("is never added for Staff, or without the Dashboard Module", () => {
    expect(shellPages(["/dashboard"], "Staff / Employee")).not.toContain("/dashboard/ai-insights");
    expect(canSeeAiInsights("Staff / Employee")).toBe(false);
    expect(shellPages(["/orders"], "CREOMS Manager")).not.toContain("/dashboard/ai-insights");
  });

  it("still adds Approvals for a Role holding a Module whose requests it lists", () => {
    expect(shellPages(["/returns"], "Staff / Employee")).toEqual(["/returns", "/approvals"]);
    expect(shellPages(["/tickets"], "Staff / Employee")).toEqual(["/tickets"]);
  });
});
