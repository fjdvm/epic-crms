import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireModule: vi.fn(),
  openTicket: vi.fn(),
  after: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/tickets/new-ticket", () => ({ openTicket: mocks.openTicket }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => "reader", ticketsWriterDatabase: () => "writer" }));
vi.mock("@/lib/gateway", () => ({ gatewayFileStorage: {}, storefrontTicketUrl: vi.fn(), sendAppEmail: vi.fn() }));

import { openNewTicket } from "@/features/tickets/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModule.mockResolvedValue({ username: "bernice", name: "Bernice" });
});

it("connects successful saves to Next's post-response scheduler and invalidates Tickets", async () => {
  mocks.openTicket.mockResolvedValue({ ok: true, id: 209, emailed: null });
  const form = new FormData();
  form.set("subject", "Cracked lid");
  form.set("customerId", "c2");
  form.set("description", "Please replace");
  expect(await openNewTicket(form)).toEqual({ ok: true, id: 209, emailed: null });
  expect(mocks.requireModule).toHaveBeenCalledWith("Tickets");
  const args = mocks.openTicket.mock.calls[0];
  expect(args.slice(0, 3)).toEqual(["writer", "reader", { id: "bernice", name: "Bernice" }]);
  expect(args[4].afterSave).toBe(mocks.after);
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/tickets");
});

it("proves access before attempting a write", async () => {
  mocks.requireModule.mockRejectedValueOnce(new Error("denied"));
  await expect(openNewTicket(new FormData())).rejects.toThrow("denied");
  expect(mocks.openTicket).not.toHaveBeenCalled();
});
