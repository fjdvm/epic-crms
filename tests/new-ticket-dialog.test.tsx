// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NewTicketActions } from "@/features/tickets/new-ticket-dialog";
import { NewTicketDialog } from "@/features/tickets/new-ticket-dialog";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/features/tickets/actions", () => ({
  findCustomers: vi.fn(),
  findCustomerOrders: vi.fn(),
  openNewTicket: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mark = { id: "c2", name: "Mark Tan", email: "mark@example.com" };

function setup(overrides: Partial<NewTicketActions> = {}) {
  const actions: NewTicketActions = {
    findCustomers: vi.fn(async () => [mark]),
    findCustomerOrders: vi.fn(async () => [
      { id: 1033, status: "delivered", createdAt: new Date("2026-10-15T04:00:00Z") },
    ]),
    openNewTicket: vi.fn(async () => ({ ok: true as const, id: 209, emailed: true })),
    ...overrides,
  };
  render(<NewTicketDialog actions={actions} />);
  fireEvent.click(screen.getByRole("button", { name: "New ticket" }));

  return actions;
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function chooseMark() {
  type(/Customer/, "mark");
  fireEvent.click(await screen.findByRole("button", { name: /Mark Tan/ }));
}

describe("the New ticket dialog as designed", () => {
  it("has the Figma fields, minus Channel and Assign to", () => {
    setup();

    expect(screen.getByRole("heading", { name: "New ticket" })).toBeTruthy();
    for (const label of [/Subject/, /Customer/, "Linked order", "Description"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Low", "Normal", "High", "Urgent"]);
    expect(screen.getByText("JPG or PNG, up to 5 MB each")).toBeTruthy();
    expect(screen.queryByText("Channel")).toBeNull();
    expect(screen.queryByText("Assign to")).toBeNull();
    expect(screen.getByRole("button", { name: "Create ticket" })).toBeTruthy();
  });

  it("defaults the Priority to Normal", () => {
    setup();

    expect(screen.getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("choosing a Customer and a Linked order", () => {
  it("lists only the chosen Customer's Orders, and none before one is chosen", async () => {
    const actions = setup();

    expect((screen.getByLabelText("Linked order") as HTMLSelectElement).disabled).toBe(true);
    await chooseMark();

    await screen.findByRole("option", { name: /#1033 · Delivered 15 Oct/ });
    expect(actions.findCustomerOrders).toHaveBeenCalledWith("c2");
    expect((screen.getByLabelText("Linked order") as HTMLSelectElement).disabled).toBe(false);
  });

  it("drops the Orders again when the Customer is changed", async () => {
    setup();
    await chooseMark();
    await screen.findByRole("option", { name: /#1033/ });

    type(/Customer/, "mar");

    expect(screen.queryByRole("option", { name: /#1033/ })).toBeNull();
    expect((screen.getByLabelText("Linked order") as HTMLSelectElement).disabled).toBe(true);
  });
});

describe("creating the Ticket", () => {
  it("sends the form, then goes to the new Ticket", async () => {
    const actions = setup();
    type(/Subject/, "Halaya tub lid cracked");
    await chooseMark();
    fireEvent.change(await screen.findByLabelText("Linked order"), { target: { value: "1033" } });
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    type("Description", "Customer called.");
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/tickets/209"));
    const form = vi.mocked(actions.openNewTicket).mock.calls[0][0];
    expect(Object.fromEntries(form)).toEqual({
      subject: "Halaya tub lid cracked",
      customerId: "c2",
      orderId: "1033",
      priority: "high",
      description: "Customer called.",
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it("will not send without a Customer chosen from the results", async () => {
    const actions = setup();
    type(/Subject/, "Something");
    type(/Customer/, "Mark Tan");
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    expect(actions.openNewTicket).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Choose a Customer from the search results.");
  });

  it("says why when the Ticket is refused and stays open", async () => {
    setup({ openNewTicket: vi.fn(async () => ({ ok: false as const, reason: "empty-message" as const })) });
    type(/Subject/, "Something");
    await chooseMark();
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("description")));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "New ticket" })).toBeTruthy();
  });

  it("refuses a file that is not a JPG or PNG before it travels", () => {
    setup();
    const file = new File(["%PDF"], "x.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Attach an image"), { target: { files: [file] } });

    expect(toast.error).toHaveBeenCalledWith("Only JPG or PNG images can be attached.");
  });

  it("attaches a picked image to the form", async () => {
    const actions = setup();
    type(/Subject/, "Something");
    await chooseMark();
    const file = new File([new Uint8Array([1, 2, 3])], "lid.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Attach an image"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

    await waitFor(() => expect(actions.openNewTicket).toHaveBeenCalled());
    expect((vi.mocked(actions.openNewTicket).mock.calls[0][0].get("image") as File).name).toBe("lid.png");
  });
});
