// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ProfileInput } from "@/components/shared/profile-input";
import { maskProfileInput, validateProfileUpdate } from "@/lib/profile-fields";

afterEach(cleanup);

describe("maskProfileInput", () => {
  it("drops characters a name does not allow", () => expect(maskProfileInput("firstName", "J0hn!")).toBe("Jhn"));
  it("keeps digits and one leading + in a contact number", () => {
    expect(maskProfileInput("contactNumber", "+63 (917) 12-34a")).toBe("+6391712" + "34");
    expect(maskProfileInput("contactNumber", "09+17")).toBe("0917");
    expect(maskProfileInput("contactNumber", "++63")).toBe("+63");
  });
  it("drops characters an address does not allow", () => expect(maskProfileInput("street", "12 Rizal St. <b>")).toBe("12 Rizal St. b"));
  it("drops spaces and control characters from an email", () => expect(maskProfileInput("email", " a b@x.com\n")).toBe("ab@x.com"));
  it("cuts to the field's maximum length", () => expect(maskProfileInput("firstName", "a".repeat(150))).toHaveLength(100));
  it("leaves unknown fields alone", () => expect(maskProfileInput("nickname", "x1")).toBe("x1"));
});

describe("ProfileInput", () => {
  it("blocks invalid characters while typing", async () => {
    render(<ProfileInput field="contactNumber" label="Contact number" />);
    const input = screen.getByLabelText("Contact number") as HTMLInputElement;
    await userEvent.type(input, "09a17-");
    expect(input.value).toBe("0917");
  });

  it("blocks invalid characters when pasting", async () => {
    render(<ProfileInput field="firstName" label="First name" />);
    const input = screen.getByLabelText("First name") as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.paste("Ma1ria <3");
    expect(input.value).toBe("Maria ");
  });

  it("shows the server's message beside an invalid field on blur", async () => {
    render(<ProfileInput field="contactNumber" label="Contact number" />);
    const input = screen.getByLabelText("Contact number");
    await userEvent.type(input, "123");
    fireEvent.blur(input);
    const expected = validateProfileUpdate({ contactNumber: "123" }).contactNumber;
    expect(screen.getByRole("alert").textContent).toBe(expected);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows no message for a valid value", async () => {
    render(<ProfileInput field="email" label="Email" />);
    const input = screen.getByLabelText("Email");
    await userEvent.type(input, "a@b.co");
    fireEvent.blur(input);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a server-side error passed in", () => {
    render(<ProfileInput field="email" label="Email" serverError="Email is already used." />);
    expect(screen.getByRole("alert").textContent).toBe("Email is already used.");
  });
});
