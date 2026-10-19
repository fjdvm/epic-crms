// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/customer-profiles/actions", () => ({ addWalkInCustomer: vi.fn() }));

import { AddCustomerForm } from "@/features/customer-profiles/add-customer-form";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

afterEach(() => {
  cleanup();
  push.mockReset();
});

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/First name/), "Ada");
  await user.type(screen.getByLabelText(/Last name/), "Lovelace");
  await user.type(screen.getByLabelText(/Mobile number/), "0917 123 4567");
}

describe("AddCustomerForm", () => {
  it("blocks saving and marks the required fields when they are empty", async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    render(<AddCustomerForm save={save} />);

    await user.click(screen.getByRole("button", { name: "Save customer" }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("First name is required.")).toBeTruthy();
    expect(screen.getByText("Last name is required.")).toBeTruthy();
    expect(screen.getByText("Mobile number is required.")).toBeTruthy();
    expect(screen.getByText("Fields marked * are required.")).toBeTruthy();
  });

  it("shows an inline error for a mobile number that is not 11 digits and an incomplete email", async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    render(<AddCustomerForm save={save} />);

    await user.type(screen.getByLabelText(/First name/), "Ada");
    await user.type(screen.getByLabelText(/Last name/), "Lovelace");
    await user.type(screen.getByLabelText(/Mobile number/), "0917");
    await user.type(screen.getByLabelText(/^Email$/), "ada@");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/11-digit Philippine mobile number/)).toBeTruthy();
    expect(screen.getByText(/complete email address/)).toBeTruthy();
  });

  it("saves with the required fields only and opens the new profile", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, id: "w-123" });
    const user = userEvent.setup();
    render(<AddCustomerForm save={save} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/customer-profiles/w-123"));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Ada", lastName: "Lovelace", mobile: "0917 123 4567" }));
  });

  it("links to the existing profile when the email or mobile number is a duplicate", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, duplicate: { id: "u-1", name: "Ben Reyes", field: "mobile" } });
    const user = userEvent.setup();
    render(<AddCustomerForm save={save} />);

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    const link = await screen.findByRole("link", { name: "Ben Reyes" });
    expect(link.getAttribute("href")).toBe("/customer-profiles/u-1");
    expect(push).not.toHaveBeenCalled();
  });

  it("collects tags, consent and notes into the saved input, including a tag still being typed", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, id: "w-1" });
    const user = userEvent.setup();
    render(<AddCustomerForm save={save} />);

    await fillRequired(user);
    await user.type(screen.getByPlaceholderText(/Add tag/), "wedding{Enter}");
    await user.type(screen.getByPlaceholderText(/Add tag/), "vip");
    await user.click(screen.getByRole("button", { name: "Remove tag wedding" }));
    await user.click(screen.getByRole("switch", { name: "SMS promos" }));
    await user.type(screen.getByRole("textbox", { name: "Internal notes" }), "June wedding");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ tags: ["vip"], smsConsent: true, emailConsent: false, notes: "June wedding" }));
  });
});
