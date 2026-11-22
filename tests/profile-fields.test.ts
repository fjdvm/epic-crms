import { describe, expect, it } from "vitest";

import {
  validateAddressField, validateContactNumber, validateEmail, validateName, validateProfileUpdate,
} from "@/lib/profile-fields";

describe("validateName", () => {
  it.each(["Juan", "Maria Clara", "Anne-Marie", "O'Brien", "Jr.", "Ñoño", "Dela Cruz"])("accepts %s", (v) => {
    expect(validateName(v)).toBeNull();
  });
  it.each(["J0hn", "Juan!", "", "   ", "a@b", "-Juan", "<b>x</b>"])("rejects %j", (v) => {
    expect(validateName(v)).not.toBeNull();
  });
  it("rejects non-strings and over-long values", () => {
    expect(validateName(undefined)).toBe("Name is required.");
    expect(validateName("a".repeat(101))).toMatch(/at most 100/);
  });
  it("uses the field label", () => {
    expect(validateName("1", "First name")).toMatch(/^First name can only/);
  });
});

describe("validateContactNumber", () => {
  it.each(["09171234567", "+639171234567"])("accepts %s", (v) => expect(validateContactNumber(v)).toBeNull());
  it.each(["0917 123 4567", "09171234567a", "++639171234567", "63+9171234567", "123", "1".repeat(16), ""])("rejects %j", (v) => {
    expect(validateContactNumber(v)).not.toBeNull();
  });
});

describe("validateEmail", () => {
  it.each(["a@b.com", "first.last+tag@example.co.ph", "o'brien@mail.example.com"])("accepts %s", (v) => {
    expect(validateEmail(v)).toBeNull();
  });
  it.each(["", "plain", "a@b", "a b@c.com", "a@@b.com", "a..b@c.com", "a@-b.com", "a@b.com ,x"])("rejects %j", (v) => {
    expect(validateEmail(v)).not.toBeNull();
  });
  it("rejects over 254 characters", () => {
    expect(validateEmail(`${"a".repeat(250)}@b.com`)).toMatch(/at most 254/);
  });
});

describe("validateAddressField", () => {
  it.each(["12 Rizal St.", "Unit 4B, Tower #2 (North)", "Brgy. San Juan", "Mañalac & Sons / Annex"])("accepts %s", (v) => {
    expect(validateAddressField(v)).toBeNull();
  });
  it.each(["", "<script>", "Street; drop table", "a".repeat(201), "emoji 😀"])("rejects %j", (v) => {
    expect(validateAddressField(v)).not.toBeNull();
  });
  it("uses the field label", () => expect(validateAddressField("", "City")).toBe("City is required."));
});

describe("validateProfileUpdate", () => {
  it("returns no errors for a valid update", () => {
    expect(validateProfileUpdate({ firstName: "Juan", contactNumber: "+639171234567", email: "j@x.com", city: "Makati" })).toEqual({});
  });
  it("returns a message per invalid field", () => {
    const errors = validateProfileUpdate({ firstName: "J0", contactNumber: "abc", email: "x" });
    expect(Object.keys(errors).sort()).toEqual(["contactNumber", "email", "firstName"]);
  });
  it("rejects an age field and other unknown fields", () => {
    expect(validateProfileUpdate({ age: 30 })).toEqual({ age: "This field cannot be updated." });
    expect(validateProfileUpdate({ constructor: "x" })).toHaveProperty("constructor");
  });
  it("rejects a non-object body", () => {
    expect(validateProfileUpdate(null)).toHaveProperty("_");
    expect(validateProfileUpdate([])).toHaveProperty("_");
  });
});
