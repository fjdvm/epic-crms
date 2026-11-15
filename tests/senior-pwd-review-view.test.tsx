// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { approveVerification, declineVerification, loadVerificationPhoto } from "@/features/senior-pwd/actions";
import { VerificationsView } from "@/features/senior-pwd/review-view";
import type { Verification } from "@/features/senior-pwd/verifications";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/senior-pwd/actions", () => ({
  approveVerification: vi.fn(), declineVerification: vi.fn(), overrideVerification: vi.fn(),
  revokeVerification: vi.fn(), loadVerificationPhoto: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const v = (o: Partial<Verification>): Verification => ({
  id: 1, customerId: "c1", customerName: "Maria Santos", idType: "senior", status: "pending",
  submittedAt: new Date("2026-11-10T00:00:00Z"), photoFileId: "f", photoBackFileId: null, photoExpiresAt: new Date("2026-11-17T00:00:00Z"),
  decidedByName: null, decidedAt: null, declineReason: null, expiresOn: null, ...o,
});

describe("the Senior/PWD review screen", () => {
  it("shows the account name, the photo and no stored number, then approves with an expiry date", async () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: true, url: "https://files.test/photo.png", backUrl: "https://files.test/back.png" });
    vi.mocked(approveVerification).mockResolvedValue({ ok: true, status: "approved", photoRemoved: true });
    render(<VerificationsView list={{ pending: [v({})], decided: [] }} role="staff" />);
    expect(screen.getByText("Maria Santos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByAltText("ID photo of Maria Santos")).getAttribute("src")).toBe("https://files.test/photo.png");
    expect(screen.getByAltText("Back of the ID of Maria Santos").getAttribute("src")).toBe("https://files.test/back.png");
    const confirm = screen.getAllByRole("button", { name: "Approve" }).at(-1)!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("ID expiry date"), { target: { value: "2030-01-01" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(approveVerification).toHaveBeenCalledWith(1, "2030-01-01"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("is not optimistic: a refusal is told in plain words", async () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: true, url: "u", backUrl: null });
    vi.mocked(declineVerification).mockResolvedValue({ ok: false, reason: "This verification already changed; refresh it before trying again." });
    render(<VerificationsView list={{ pending: [v({})], decided: [] }} role="manager" />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Blurry" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Decline" }).at(-1)!);
    expect(await screen.findByText("Declining…")).toBeTruthy();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("already changed")));
  });

  it("says why when the photo is gone", async () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: false, reason: "The ID photo has been removed." });
    render(<VerificationsView list={{ pending: [v({})], decided: [] }} role="staff" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toContain("removed");
  });

  it("gives each role its own buttons on a decided ID", () => {
    const decided = [v({ id: 2, status: "declined", declineReason: "Blurry", decidedByName: "Ana" })];
    const staff = render(<VerificationsView list={{ pending: [], decided }} role="staff" />);
    expect(screen.getByText("Request approval")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Override" })).toBeNull();
    staff.unmount();
    const manager = render(<VerificationsView list={{ pending: [], decided }} role="manager" />);
    expect(screen.getByRole("button", { name: "Override" })).toBeTruthy();
    manager.unmount();
    render(<VerificationsView list={{ pending: [v({})], decided }} role="ceo" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the empty state", () => {
    render(<VerificationsView list={{ pending: [], decided: [] }} role="staff" />);
    expect(screen.getByText("Nothing is waiting for review.")).toBeTruthy();
  });
});
