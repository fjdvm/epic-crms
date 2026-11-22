import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { staff, run, apply, nudge } = vi.hoisted(() => ({
  staff: { current: { id: "s1", name: "Sam", username: "sam", role: "Staff/Employee" } },
  run: vi.fn(), apply: vi.fn(), nudge: vi.fn(),
}));
vi.mock("@/lib/portal/staff", () => ({ requireModule: async () => staff.current }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: {} }));
vi.mock("@/features/files/reference", () => ({ openUpload: vi.fn() }));
vi.mock("@/features/files/storage", () => ({ directFileStorage: {}, storageUrl: (url: string) => url }));
vi.mock("@/features/approvals/server", () => ({ approvals: () => ({ run }) }));
vi.mock("@/features/management/storefront-nudge", () => ({ nudgeStorefront: nudge }));
vi.mock("@/features/orders/product-content", () => ({ applyProductPrice: apply, saveProductContent: vi.fn() }));

import { setProductPrice } from "@/features/orders/product-content-actions";

beforeEach(() => {
  apply.mockResolvedValue({ ok: true });
  nudge.mockResolvedValue(undefined);
  // The real workflow: a Manager executes at once; Staff with a reason wait for a Manager.
  run.mockImplementation(async (who: { role: string }, _input: unknown, options: { reason?: string }, execute: () => Promise<unknown>) => {
    if (who.role === "CREOMS Manager" || who.role === "CEO") return execute();
    return options.reason ? { ok: false, reason: "Waiting for approval", approvalId: "a1" } : { ok: false, reason: "Request approval with a reason." };
  });
});
afterEach(() => vi.clearAllMocks());

it.each(["CREOMS Manager", "CEO"])("lets a %s set the price at once, as money, and tells the storefront", async (role) => {
  staff.current = { ...staff.current, role };
  expect(await setProductPrice(12, "1,250.50")).toEqual({ ok: true });
  expect(run.mock.calls[0][1]).toEqual({ module: "Orders", action: "product.price", targetId: "12", payload: { price: 1250.5 }, amountInCentavos: 125050 });
  expect(apply).toHaveBeenCalledWith({}, {}, staff.current, { productId: 12, price: 1250.5 });
  expect(nudge).toHaveBeenCalledTimes(1);
});

it("sends a Staff price to a Manager with a reason, and changes nothing yet", async () => {
  staff.current = { ...staff.current, role: "Staff/Employee" };
  expect(await setProductPrice(12, "300", "Supplier cost went up.")).toMatchObject({ ok: false, reason: "Waiting for approval" });
  expect(apply).not.toHaveBeenCalled();
  expect(nudge).not.toHaveBeenCalled();
});

it("refuses Admin, a bad product and a bad price before asking anyone", async () => {
  staff.current = { ...staff.current, role: "Super Admin" };
  expect(await setProductPrice(12, "300")).toEqual({ ok: false, reason: "Your Role can only view shop work." });
  staff.current = { ...staff.current, role: "CREOMS Manager" };
  expect((await setProductPrice(0, "300")).ok).toBe(false);
  expect(await setProductPrice(12, "0")).toEqual({ ok: false, reason: "Enter a price above ₱0 with at most two decimals." });
  expect(run).not.toHaveBeenCalled();
});

it("keeps a saved price when the storefront cannot be told", async () => {
  staff.current = { ...staff.current, role: "CREOMS Manager" };
  nudge.mockRejectedValueOnce(new Error("gateway down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await setProductPrice(12, "300")).toEqual({ ok: true });
});
