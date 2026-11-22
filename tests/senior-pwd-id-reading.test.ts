import { describe, expect, it } from "vitest";

import { nameMatches, parseIdText } from "@/features/senior-pwd/id-reading";

const front = `OFFICE OF SENIOR CITIZENS AFFAIRS
City of Antipolo
RAMOS, LITO M.
ID No. ANT-SC-0458721
Born 04 Feb 1958`;

describe("turning recognised ID text into fields", () => {
  it("reads the name, the ID number and no expiry from a Senior Citizen ID", () => {
    expect(parseIdText(front)).toEqual({ name: "RAMOS, LITO M.", idNumber: "ANT-SC-0458721", expiresOn: null });
  });

  it("reads a PWD expiry written as a date", () => {
    const text = "PERSON WITH DISABILITY\nDELA CRUZ, ANA B.\nPWD ID NO: 0412-2231-0099\nValid until 15 Mar 2031";
    expect(parseIdText(text)).toEqual({ name: "DELA CRUZ, ANA B.", idNumber: "0412-2231-0099", expiresOn: "2031-03-15" });
  });

  it("reads numeric expiry dates", () => {
    expect(parseIdText("Name: Ana Cruz\nID No. 12345\nExpiry 2031/03/05").expiresOn).toBe("2031-03-05");
    expect(parseIdText("Name: Ana Cruz\nID No. 12345\nExpires 05-03-2031").expiresOn).toBe("2031-03-05");
  });

  it("leaves a field empty when the text does not show it", () => {
    expect(parseIdText("blurry ~~ ###")).toEqual({ name: null, idNumber: null, expiresOn: null });
    expect(parseIdText("")).toEqual({ name: null, idNumber: null, expiresOn: null });
  });
});

describe("comparing the name on the ID with the account", () => {
  it("matches in either order and ignores case, commas, dots and a middle initial", () => {
    expect(nameMatches("RAMOS, LITO M.", "Lito Ramos")).toBe(true);
    expect(nameMatches("Lito M. Ramos", "Lito Ramos")).toBe(true);
  });
  it("does not match a different person", () => {
    expect(nameMatches("SANTOS, MARIA", "Lito Ramos")).toBe(false);
    expect(nameMatches("", "Lito Ramos")).toBe(false);
  });
});
