// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import CustomerProfilePage from "@/app/(app)/customer-profiles/[id]/page";
import { CustomerProfileView } from "@/features/customer-profiles/customer-profile";
import type { CustomerProfile } from "@/features/customer-profiles/profile";
import type { AddCustomerNoteResult } from "@/features/customer-profiles/note-actions";

const access = vi.hoisted(() => ({ role: "Staff", load: vi.fn() }));
const add = vi.fn();
vi.mock("@/lib/portal/staff", () => ({ requireModule: async () => ({ id: "r", name: "Rhea", role: access.role }), heldModules: async () => [], canOpenOrders: async () => false }));
vi.mock("@/features/customer-profiles/profile", () => ({ loadCustomerProfile: (...args: unknown[]) => access.load(...args) }));
vi.mock("@/features/customer-profiles/profile-view-audit", () => ({ ProfileViewAudit: () => null }));
vi.mock("@/features/customer-profiles/note-actions", () => ({ addCustomerNote: (...args: unknown[]) => add(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const profile: CustomerProfile = {
  id: "c", name: "Maria Santos", firstName: "Maria", middleName: null, lastName: "Santos", email: "maria@example.test", contactNumber: "09171234567", marketingOptIn: false,
  customerSince: new Date("2026-01-01"), stage: "new", defaultCity: null, orders: 0, totalSpent: 0, averageOrder: null, lastOrder: null, feedbackCount: 0, averageRating: null,
  addresses: [], orderHistory: [], cart: { lines: [], total: 0 }, walkIn: null, mergedWalkIn: null, emailsReceived: [], returns: [], notes: [],
};
it("opens cached notes immediately and keeps a pending save across tab switches, including timeline rollback", async () => {
  let finish!: (result: AddCustomerNoteResult) => void;
  add.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<CustomerProfileView profile={profile} noteAuthor={{ id: "r", name: "Rhea" }} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Notes & tasks" }));
  expect(screen.getByText("No Customer notes yet")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Saturday pickup" } });
  await user.click(screen.getByRole("button", { name: "Save note" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save note" }));
  expect(screen.getByText(/Rhea added a Customer note/)).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Cart" }));
  await user.click(screen.getByRole("tab", { name: "Notes & tasks" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Saturday pickup");
  expect((screen.getByRole("button", { name: "Save note" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({ ok: false, message: "Customer no longer exists." }));
  expect(screen.getByRole("alert").textContent).toBe("Customer no longer exists.");
  expect(screen.queryByText(/Rhea added a Customer note/)).toBeNull();
});

it.each(["Admin", "CEO"])("%s reads cached notes without a composer", async role => {
  access.role = role;
  access.load.mockResolvedValue({ ok: true, profile: { ...profile, notes: [{ id: "1", customerId: "c", authorId: "r", authorName: "Rhea", text: "Prefers pickup", createdAt: "2026-03-01T00:00:00.000Z" }] } });
  render(await CustomerProfilePage({ params: Promise.resolve({ id: "c" }) }));
  await userEvent.click(screen.getByRole("tab", { name: "Notes & tasks" }));
  expect(screen.getByRole("list", { name: "Customer notes" }).textContent).toContain("Prefers pickup");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save note" })).toBeNull();
});

it.each(["Staff", "CREOMS Manager"])("%s receives the composer on the Profile page", async role => {
  access.role = role;
  access.load.mockResolvedValue({ ok: true, profile });
  render(await CustomerProfilePage({ params: Promise.resolve({ id: "c" }) }));
  await userEvent.click(screen.getByRole("tab", { name: "Notes & tasks" }));
  expect(screen.getByRole("textbox", { name: "Customer note" })).toBeTruthy();
});
