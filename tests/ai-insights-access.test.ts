import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
const nav = vi.hoisted(() => ({ redirect: vi.fn(), requireModule: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: nav.redirect }));
vi.mock("@/lib/portal/staff", async (actual) => ({ ...(await actual<typeof import("@/lib/portal/staff")>()), requireModule: nav.requireModule }));

import FeedbackPage from "@/app/(app)/feedback/page";
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

describe("the old Feedback page", () => {
  it("sends Manager-level Roles and Admin to the Feedback cards, and Staff to Customer Profiles", async () => {
    for (const [role, to] of [
      ["CREOMS Manager", "/dashboard/ai-insights?category=feedback"], ["CEO", "/dashboard/ai-insights?category=feedback"],
      ["Admin", "/dashboard/ai-insights?category=feedback"], ["Staff / Employee", "/customer-profiles"],
    ]) {
      nav.redirect.mockClear();
      nav.requireModule.mockResolvedValueOnce({ id: "s1", name: "Rhea", role });
      await FeedbackPage();
      expect(nav.requireModule).toHaveBeenLastCalledWith("Feedback");
      expect(nav.redirect).toHaveBeenCalledWith(to);
    }
  });
});
