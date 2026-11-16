import { expect, it, vi } from "vitest";
const { role, read } = vi.hoisted(() => ({
  role: { value: "Staff" },
  read: vi.fn(async () => ({
    questions: 0,
    lastWeek: 0,
    answered: 0,
    handedOff: 0,
    kinds: [],
    flags: [],
  })),
}));
vi.mock("@/lib/portal/staff", () => ({
  requireModule: vi.fn(async () => ({ role: role.value })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => ({}) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/features/order-assistant/data", async (original) => ({
  ...(await original<typeof import("@/features/order-assistant/data")>()),
  loadResults: read,
}));
import ResultsPage from "@/app/(app)/tickets/assistant/results/page";
import { requireModule } from "@/lib/portal/staff";
import { TICKETS_MODULE } from "@/lib/portal/config";
it("denies Staff before reading Results and requires the Tickets Module", async () => {
  role.value = "Staff";
  read.mockClear();
  await expect(ResultsPage()).rejects.toThrow("redirect:");
  expect(read).not.toHaveBeenCalled();
  expect(requireModule).toHaveBeenCalledWith(TICKETS_MODULE);
});
it.each(["CREOMS Manager", "Admin", "CEO"])(
  "allows %s to read saved Results",
  async (value) => {
    role.value = value;
    read.mockClear();
    expect(await ResultsPage()).toBeTruthy();
    expect(read).toHaveBeenCalledOnce();
  },
);
