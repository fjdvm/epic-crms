import { describe, expect, it } from "vitest";

import { isAssignable, shopRole } from "@/lib/portal/roles";

describe("who a Ticket can be assigned to", () => {
  it("allows Staff, CREOMS Manager and General Manager", () => {
    for (const role of ["Staff", "Staff / Employee", "CREOMS Manager", "General Manager"]) expect(isAssignable(role)).toBe(true);
    expect(shopRole("General Manager")).toBe("manager");
  });

  it("never allows Admin, CEO, VP or an unknown Role", () => {
    for (const role of ["Admin", "Super Admin", "CEO", "VP", "", "Intern"]) expect(isAssignable(role)).toBe(false);
  });
});

describe("CEO and VP act as a Manager", () => {
  it("map CEO, VP and Vice President to the Manager shop Role with Management", async () => {
    const { canManage, canWork } = await import("@/lib/portal/roles");
    for (const role of ["CEO", "VP", "Vice President", "CREOMS Manager", "General Manager"]) {
      expect(shopRole(role)).toBe("manager");
      expect(canWork({ role })).toBe(true);
      expect(canManage({ role })).toBe(true);
    }
  });

  it("keeps CEO, VP and Vice President out of Ticket assignment", () => {
    for (const role of ["CEO", "VP", "Vice President"]) expect(isAssignable(role)).toBe(false);
  });
});
