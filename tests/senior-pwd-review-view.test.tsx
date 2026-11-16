// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { approveVerification, declineVerification, loadVerificationPhoto } from "@/features/senior-pwd/actions";
import { readIdPhoto } from "@/features/senior-pwd/read-id-photo";
import { VerificationsView } from "@/features/senior-pwd/review-view";
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

const v = (o: Partial<Verification>): Verification => ({
  id: 1, customerId: "c1", customerName: "Maria Santos", idType: "senior", status: "pending",
  submittedAt: new Date("2026-11-10T00:00:00Z"), photoFileId: "f", photoBackFileId: null, photoExpiresAt: new Date("2026-11-17T00:00:00Z"),
  decidedByName: null, decidedAt: null, declineReason: null, expiresOn: null, ...o,
});

describe("the Senior/PWD review screen", () => {
  const open = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByAltText("ID photo of Maria Santos");
  };
  const approveButton = () => screen.getAllByRole("button", { name: "Approve" }).at(-1) as HTMLButtonElement;

  it("pre-fills the fields from the photo, applies nothing until each is confirmed, then approves", async () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: true, url: "https://files.test/photo.png", backUrl: "https://files.test/back.png" });
    vi.mocked(readIdPhoto).mockResolvedValue("SANTOS, MARIA L.\nID No. SC-123456\nValid until 15 Mar 2031");
    vi.mocked(approveVerification).mockResolvedValue({ ok: true, status: "approved", photoRemoved: true });
    render(<VerificationsView list={{ pending: [v({})], decided: [] }} role="staff" />);
    await open();
    await waitFor(() => expect(readIdPhoto).toHaveBeenCalledWith("https://files.test/photo.png"));
    expect(screen.getByAltText("Back of the ID of Maria Santos").getAttribute("src")).toBe("https://files.test/back.png");
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("SANTOS, MARIA L."));
    expect((screen.getByLabelText("ID number") as HTMLInputElement).value).toBe("SC-123456");
    expect((screen.getByLabelText("Expiry") as HTMLInputElement).value).toBe("2031-03-15");
    expect(approveButton().disabled).toBe(true);
    for (const f of ["name", "id number", "expiry"]) fireEvent.click(screen.getByRole("button", { name: `Confirm ${f}` }));
    await waitFor(() => expect(approveButton().disabled).toBe(false));
    fireEvent.click(approveButton());
    await waitFor(() => expect(approveVerification).toHaveBeenCalledWith(1, "2031-03-15"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("lets Staff type over a field, which must then be confirmed again", async () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: true, url: "u", backUrl: null });
    vi.mocked(readIdPhoto).mockResolvedValue("SANTOS, MARIA L.\nID No. SC-123456\nValid until 15 Mar 2031");
    vi.mocked(approveVerification).mockResolvedValue({ ok: true, status: "approved", photoRemoved: true });
    render(<VerificationsView list={{ pending: [v({})], decided: [] }} role="staff" />);
    await open();
    await waitFor(() => expect((screen.getByLabelText("Expiry") as HTMLInputElement).value).toBe("2031-03-15"));
    for (const f of ["name", "id number", "expiry"]) fireEvent.click(screen.getByRole("button", { name: `Confirm ${f}` }));
    fireEvent.change(screen.getByLabelText("Expiry"), { target: { value: "2032-01-01" } });
    await waitFor(() => expect(approveButton().disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Confirm expiry" }));
    await waitFor(() => expect(approveButton().disabled).toBe(false));
    fireEvent.click(approveButton());
    await waitFor(() => expect(approveVerification).toHaveBeenCalledWith(1, "2032-01-01"));
  });

  it("keeps working by hand when the reading fails", async () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: true, url: "u", backUrl: null });
    vi.mocked(readIdPhoto).mockRejectedValue(new Error("no wasm"));
    vi.mocked(approveVerification).mockResolvedValue({ ok: true, status: "approved", photoRemoved: true });
    render(<VerificationsView list={{ pending: [v({})], decided: [] }} role="staff" />);
    await open();
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Santos, Maria" } });
    fireEvent.change(screen.getByLabelText("ID number"), { target: { value: "SC-1" } });
    fireEvent.change(screen.getByLabelText("Expiry"), { target: { value: "2031-03-15" } });
    for (const f of ["name", "id number", "expiry"]) fireEvent.click(screen.getByRole("button", { name: `Confirm ${f}` }));
    await waitFor(() => expect(approveButton().disabled).toBe(false));
    fireEvent.click(approveButton());
    await waitFor(() => expect(approveVerification).toHaveBeenCalledWith(1, "2031-03-15"));
  });

  it("stops approval when the confirmed name does not match the account", async () => {
    vi.mocked(loadVerificationPhoto).mockResolvedValue({ ok: true, url: "u", backUrl: null });
    vi.mocked(readIdPhoto).mockResolvedValue("RAMOS, LITO M.\nID No. SC-9\nValid until 15 Mar 2031");
    render(<VerificationsView list={{ pending: [v({})], decided: [] }} role="staff" />);
    await open();
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("RAMOS, LITO M."));
    for (const f of ["name", "id number", "expiry"]) fireEvent.click(screen.getByRole("button", { name: `Confirm ${f}` }));
    expect((await screen.findByRole("alert")).textContent).toContain("does not match");
    expect(approveButton().disabled).toBe(true);
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
