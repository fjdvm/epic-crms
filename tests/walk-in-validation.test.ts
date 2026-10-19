import { describe, expect, it } from "vitest";

import { normaliseMobile, validateWalkIn } from "@/features/customer-profiles/walk-in-rules";

const required = { firstName: "Ada", lastName: "Lovelace", mobile: "09171234567" };

describe("normaliseMobile", () => {
  it("reduces a Philippine mobile number to 11 digits starting 09", () => {
    expect(normaliseMobile("0917 123 4567")).toBe("09171234567");
    expect(normaliseMobile("0917-123-4567")).toBe("09171234567");
    expect(normaliseMobile("+63 917 123 4567")).toBe("09171234567");
    expect(normaliseMobile("639171234567")).toBe("09171234567");
  });

  it("returns null for anything that is not an 11-digit Philippine mobile number", () => {
    expect(normaliseMobile("0917123456")).toBeNull();
    expect(normaliseMobile("091712345678")).toBeNull();
    expect(normaliseMobile("08171234567")).toBeNull();
    expect(normaliseMobile("")).toBeNull();
    expect(normaliseMobile("abc")).toBeNull();
  });
});

describe("validateWalkIn", () => {
  it("accepts the required fields alone, with defaults for the rest", () => {
    const result = validateWalkIn(required);

    expect(result).toEqual({
      ok: true,
      value: {
        firstName: "Ada",
        lastName: "Lovelace",
        mobile: "09171234567",
        email: null,
        birthday: null,
        preferredContact: null,
        source: null,
        tags: [],
        emailConsent: false,
        smsConsent: false,
        notes: null,
        address: null,
      },
    });
  });

  it("requires first name, last name and mobile number", () => {
    const result = validateWalkIn({ firstName: " ", lastName: "", mobile: "" });

    expect(result).toMatchObject({
      ok: false,
      errors: { firstName: expect.any(String), lastName: expect.any(String), mobile: expect.any(String) },
    });
  });

  it("rejects a mobile number that is not an 11-digit Philippine mobile number", () => {
    expect(validateWalkIn({ ...required, mobile: "0917123" })).toMatchObject({
      ok: false,
      errors: { mobile: expect.stringContaining("11-digit") },
    });
  });

  it("rejects an incomplete email but accepts a blank one", () => {
    expect(validateWalkIn({ ...required, email: "ada@" })).toMatchObject({
      ok: false,
      errors: { email: expect.any(String) },
    });
    expect(validateWalkIn({ ...required, email: "ada@example" })).toMatchObject({ ok: false });
    expect(validateWalkIn({ ...required, email: "  " })).toMatchObject({ ok: true, value: { email: null } });
  });

  it("trims and lower-cases the email", () => {
    expect(validateWalkIn({ ...required, email: " Ada@Example.com " })).toMatchObject({
      ok: true,
      value: { email: "ada@example.com" },
    });
  });

  it("rejects an unknown source, a bad birthday and an unknown preferred contact", () => {
    expect(validateWalkIn({ ...required, source: "Carrier pigeon" })).toMatchObject({ ok: false, errors: { source: expect.any(String) } });
    expect(validateWalkIn({ ...required, birthday: "2090-01-01" })).toMatchObject({ ok: false, errors: { birthday: expect.any(String) } });
    expect(validateWalkIn({ ...required, birthday: "nope" })).toMatchObject({ ok: false });
    expect(validateWalkIn({ ...required, preferredContact: "Fax" })).toMatchObject({ ok: false, errors: { preferredContact: expect.any(String) } });
    expect(validateWalkIn({ ...required, source: "Event / expo", birthday: "1990-05-17", preferredContact: "SMS" })).toMatchObject({ ok: true });
  });

  it("de-duplicates and trims tags, dropping empties", () => {
    expect(validateWalkIn({ ...required, tags: [" wedding ", "wedding", "", "vip"] })).toMatchObject({
      ok: true,
      value: { tags: ["wedding", "vip"] },
    });
  });

  it("keeps a default delivery address only when something was entered", () => {
    expect(validateWalkIn({ ...required, address: { street: "", province: "", city: "", barangay: "", zip: "", landmark: "" } })).toMatchObject({
      ok: true,
      value: { address: null },
    });
    expect(validateWalkIn({ ...required, address: { street: "1 Rizal St", city: "Manila" } })).toMatchObject({
      ok: true,
      value: { address: { street: "1 Rizal St", city: "Manila", province: "", barangay: "", zip: "", landmark: "" } },
    });
  });
});
