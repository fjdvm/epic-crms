// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProfileViewAudit } from "@/features/customer-profiles/profile-view-audit";
const record = vi.hoisted(() => vi.fn<(id: string, token: string) => Promise<void>>(async () => {}));
vi.mock("@/features/customer-profiles/actions", () => ({ auditCustomerProfileView: record }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); record.mockReset(); });
it("retains a view token through effect retries and gives later openings a new identity", async () => {
  const page = render(<StrictMode><ProfileViewAudit id="c1" /></StrictMode>);
  await waitFor(() => expect(record).toHaveBeenCalled());
  const tokens = record.mock.calls.map(call => call[1]);
  expect(new Set(tokens).size).toBe(1);
  page.unmount();
  render(<ProfileViewAudit id="c1" />);
  await waitFor(() => expect(record.mock.calls.at(-1)?.[1]).not.toBe(tokens[0]));
});
it("does not break the visible profile when audit delivery fails", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  record.mockRejectedValueOnce(new Error("offline"));
  render(<><p>Customer Profile</p><ProfileViewAudit id="c1" /></>);
  await waitFor(() => expect(log).toHaveBeenCalled());
});
