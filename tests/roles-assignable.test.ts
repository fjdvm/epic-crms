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
