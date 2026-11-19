// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { approveVerification, declineVerification, loadVerificationPhoto } from "@/features/senior-pwd/actions";
import { SeniorPwdCheckDetail } from "@/features/senior-pwd/check-detail";
import { SeniorPwdChecksList } from "@/features/senior-pwd/checks-list";
import { readIdPhoto } from "@/features/senior-pwd/read-id-photo";
import { formatRemaining } from "@/features/senior-pwd/shared";
import type { Verification } from "@/features/senior-pwd/verifications";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/senior-pwd/actions", () => ({
  approveVerification: vi.fn(), declineVerification: vi.fn(), overrideVerification: vi.fn(),
  revokeVerification: vi.fn(), loadVerificationPhoto: vi.fn(),
}));
vi.mock("@/features/senior-pwd/read-id-photo", () => ({ readIdPhoto: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const NOW = "2026-11-17T01:00:00Z";
const v = (o: Partial<Verification> = {}): Verification => ({
  id: 1, customerId: "c1", customerName: "Maria Santos", customerEmailHint: "maria.@...", orderId: 1058, idType: "senior",
  status: "pending", submittedAt: new Date("2026-11-10T00:40:00Z"), photoFileId: "f", photoBackFileId: null,
  photoExpiresAt: new Date("2026-11-17T00:40:00Z"), decidedByName: null, decidedAt: null, declineReason: null, expiresOn: null, ...o,
});
const list = (pending: Verification[], decided: Verification[] = []) => ({ pending, decided });

describe("the Senior/PWD checks list", () => {
  it("shows what is waiting, with the order it holds and how long the photo has left", () => {
    render(<SeniorPwdChecksList list={list([v({ photoExpiresAt: new Date("2026-11-24T00:00:00Z") })])} now={NOW} readOnly={false} canOpenOrder />);
    const row = screen.getByRole("row", { name: /Maria Santos/ });
    expect(within(row).getByText("maria.@...")).toBeTruthy();
    expect(within(row).getByText("Senior citizen")).toBeTruthy();
    expect(within(row).getByText("10 Nov, 8:40 AM")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "BR-1058" }).getAttribute("href")).toBe("/orders/1058");
    expect(within(row).getByText("6 days 23 h")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Review" }).getAttribute("href")).toBe("/customer-profiles/senior-pwd/1");
    expect(screen.getByRole("tab", { name: /Waiting for review/ }).textContent).toContain("1");
    expect(screen.getByRole("note", { name: "Privacy" }).textContent).toContain("never stored");
  });

  it("shows a dash when no order is held, and a plain order number to Staff who cannot open Orders", () => {
    const { rerender } = render(<SeniorPwdChecksList list={list([v({ orderId: null })])} now={NOW} readOnly={false} />);
    expect(screen.getByText("—")).toBeTruthy();
    rerender(<SeniorPwdChecksList list={list([v()])} now={NOW} readOnly={false} />);
    expect(screen.queryByRole("link", { name: "BR-1058" })).toBeNull();
    expect(screen.getByText("BR-1058")).toBeTruthy();
  });

  it("switches to the latest decisions", () => {
    const decided = [v({ id: 2, customerName: "Lito Ramos", status: "declined", declineReason: "Blurry", decidedByName: "Ana" })];
    render(<SeniorPwdChecksList list={list([v()], decided)} now={NOW} readOnly={false} />);
    expect(screen.queryByText("Lito Ramos")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Latest decisions" }));
    expect(screen.getByText("Lito Ramos")).toBeTruthy();
    expect(screen.getByText("Declined")).toBeTruthy();
    expect(screen.getByText("Blurry")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("Maria Santos")).toBeNull();
  });

  it("says Read-only to Admin and CEO and offers View, not Review", () => {
    render(<SeniorPwdChecksList list={list([v()])} now={NOW} readOnly />);
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review" })).toBeNull();
    expect(screen.getByRole("link", { name: "View" })).toBeTruthy();
  });

  it("shows the empty states", () => {
    render(<SeniorPwdChecksList list={list([])} now={NOW} readOnly={false} />);
    expect(screen.getByText("Nothing is waiting for review.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Latest decisions" }));
    expect(screen.getByText("No decisions yet.")).toBeTruthy();
  });
});

describe("how long the photo has left", () => {
  const at = new Date("2026-11-17T00:00:00Z");
  it.each([[167 * 3_600_000, "6 days 23 h"], [5 * 3_600_000 + 60_000, "5 h"], [48 * 3_600_000, "2 days"], [600_000, "under 1 h"], [-1000, "under 1 h"]])(
    "%i ms is %s", (ms, text) => expect(formatRemaining(new Date(at.getTime() + ms), at)).toBe(text),
  );
});

describe("the Senior/PWD check screen", () => {
  const detail = (verification = v(), props: { readOnly?: boolean; role?: "staff" | "manager" | "admin" | "ceo" } = {}) =>
    render(<SeniorPwdCheckDetail verification={verification} now={NOW} readOnly={props.readOnly ?? false} role={props.role ?? "staff"} />);
  const approveButton = () => screen.getAllByRole("button", { name: "Approve" }).at(-1) as HTMLButtonElement;
  const READ = "SANTOS, MARIA L.\nID No. SC-123456\nValid until 15 Mar 2031";
  const photo = () => vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: true, url: "https://files.test/photo.png", backUrl: null });

  it("pre-fills name and expiry, applies nothing until each is confirmed, then approves", async () => {
    photo();
    vi.mocked(readIdPhoto).mockResolvedValue(READ);
    vi.mocked(approveVerification).mockResolvedValue({ ok: true, status: "approved", photoRemoved: true });
    detail();
    expect(screen.getByRole("heading", { name: "Review ID · Maria Santos" })).toBeTruthy();
    expect(screen.getByText(/holds order BR-1058/)).toBeTruthy();
    await screen.findByAltText("ID photo of Maria Santos");
    await waitFor(() => expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("SANTOS, MARIA L."));
    expect((screen.getByLabelText("Valid until") as HTMLInputElement).value).toBe("2031-03-15");
    // The ID number is never read into a field: it is shown only on the photo and not stored.
    expect((screen.getByLabelText("ID number") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("ID number") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Confirm name" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm expiry" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(approveButton());
    await waitFor(() => expect(approveVerification).toHaveBeenCalledWith(1, "2031-03-15"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("makes Staff confirm a field again after typing over it", async () => {
    photo();
    vi.mocked(readIdPhoto).mockResolvedValue(READ);
    detail();
    await waitFor(() => expect((screen.getByLabelText("Valid until") as HTMLInputElement).value).toBe("2031-03-15"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm name" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm expiry" }));
    fireEvent.change(screen.getByLabelText("Valid until"), { target: { value: "2032-01-01" } });
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Confirm expiry" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps working by hand when the reading fails", async () => {
    photo();
    vi.mocked(readIdPhoto).mockRejectedValue(new Error("no wasm"));
    detail();
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Santos, Maria" } });
    fireEvent.change(screen.getByLabelText("Valid until"), { target: { value: "2031-03-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm name" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm expiry" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("stops approval when the confirmed name does not match the account", async () => {
    photo();
    vi.mocked(readIdPhoto).mockResolvedValue("RAMOS, LITO M.\nValid until 15 Mar 2031");
    detail();
    await waitFor(() => expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("RAMOS, LITO M."));
    fireEvent.click(screen.getByRole("button", { name: "Confirm name" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm expiry" }));
    expect((await screen.findByRole("alert")).textContent).toContain("does not match");
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is not optimistic: a refusal is told in plain words", async () => {
    photo();
    vi.mocked(readIdPhoto).mockResolvedValue(READ);
    vi.mocked(declineVerification).mockResolvedValue({ ok: false, reason: "This verification already changed; refresh it before trying again." });
    detail();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Blurry" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Decline" }).at(-1)!);
    expect(await screen.findByText("Declining…")).toBeTruthy();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("already changed")));
  });

  it("says why when the photo is gone", async () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: false, reason: "The ID photo has been removed." });
    detail();
    expect((await screen.findByRole("alert")).textContent).toContain("removed");
  });

  it("gives Admin and CEO no buttons and the Read-only badge", async () => {
    photo();
    vi.mocked(readIdPhoto).mockResolvedValue(READ);
    detail(v(), { readOnly: true, role: "admin" });
    await screen.findByAltText("ID photo of Maria Santos");
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  describe("an ID already decided", () => {
    const declined = v({ status: "declined", declineReason: "Blurry", decidedByName: "Ana", decidedAt: new Date("2026-11-11T00:00:00Z"), photoFileId: null });
    it("never asks for the photo and shows the decision", () => {
      detail(declined);
      expect(loadVerificationPhoto).not.toHaveBeenCalled();
      expect(screen.getByText("Blurry")).toBeTruthy();
      expect(screen.getByText("Ana")).toBeTruthy();
      expect(screen.getByText(/photo was deleted/i)).toBeTruthy();
    });
    it("gives each role its own button", () => {
      const staff = detail(declined, { role: "staff" });
      expect(screen.getByText("Request approval")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Override" })).toBeNull();
      staff.unmount();
      const manager = detail(declined, { role: "manager" });
      expect(screen.getByRole("button", { name: "Override" })).toBeTruthy();
      manager.unmount();
      detail(declined, { readOnly: true, role: "ceo" });
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });
    it("lets a Manager revoke an approved ID", () => {
      detail(v({ status: "approved", expiresOn: "2031-03-15", decidedByName: "Ana", photoFileId: null }), { role: "manager" });
      expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    });
  });
});

describe("an ID number already used by another account", () => {
  const holder = { verificationId: 9, customerName: "Lito Ramos", customerEmailHint: "lito.r@...", status: "revoked" as const };

  it("flags the row in the list without showing the number", () => {
    render(<SeniorPwdChecksList list={list([v({ sameIdAs: holder })])} now={NOW} readOnly={false} />);
    expect(within(screen.getByRole("row", { name: /Maria Santos/ })).getByText("ID already used by another account")).toBeTruthy();
  });

  it("says nothing when the ID is only on this account", () => {
    render(<SeniorPwdChecksList list={list([v()])} now={NOW} readOnly={false} />);
    expect(screen.queryByText(/already used by another account/)).toBeNull();
  });

  it("tells the reviewer who else used it and links to that check", () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: false, reason: "n/a" } as never);
    render(<SeniorPwdCheckDetail verification={v({ sameIdAs: holder })} now={NOW} readOnly={false} role="staff" />);
    const alert = screen.getByRole("alert", { name: "" });
    expect(alert.textContent).toContain("This ID number is already used by another account.");
    expect(alert.textContent).toContain("Lito Ramos (lito.r@...) · Revoked");
    expect(within(alert).getByRole("link", { name: "Open their check" }).getAttribute("href")).toBe("/customer-profiles/senior-pwd/9");
  });
});
