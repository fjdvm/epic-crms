import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const { role, read } = vi.hoisted(() => ({
  role: { value: "Staff" },
  read: vi.fn(async () => ({
    questions: 0,
    lastWeek: 0,
    answered: 0,
    handedOff: 0,
    kinds: [],
    answeredByKind: {},
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

it("shows the drawn numbers, flagged answers read-only, and no Fix answer or time saved", async () => {
  role.value = "CEO";
  read.mockResolvedValueOnce({
    questions: 10,
    lastWeek: 5,
    answered: 9,
    handedOff: 1,
    kinds: [["order_status", 4]],
    answeredByKind: { order_status: 4 },
    flags: [
      {
        message_id: 1,
        ticket_id: 7,
        reason: "Guessed",
        staff_name: "Maria",
        answer: "Yes",
        created_at: new Date("2026-11-16T01:00Z"),
      },
    ],
  } as never);
  const html = renderToStaticMarkup(await ResultsPage());
  expect(html).toContain("+100% vs last week");
  expect(html).toContain("90%");
  expect(html).toContain("Flagged by Maria");
  expect(html).not.toMatch(/Fix answer|Staff time saved|Preview as customer/);
});
it("shows a loading skeleton at once", async () => {
  const Loading = (
    await import("@/app/(app)/tickets/assistant/results/loading")
  ).default;
  expect(renderToStaticMarkup(<Loading />)).toContain(
    "Loading Order assistant",
  );
});
