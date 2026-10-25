// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { DashboardExportButton } from "@/features/dashboard/export-button";

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("downloads the chosen period without confirmation and stays busy until the PDF is read", async () => {
  vi.useFakeTimers();
  let finish!: (blob: Blob) => void;
  const pdf = new Blob(["%PDF-test"], { type: "application/pdf" });
  const blob = new Promise<Blob>((resolve) => { finish = resolve; });
  const fetchPdf = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="dashboard-last-month-2026-10-25.pdf"',
    }),
    blob: () => blob,
  });
  vi.stubGlobal("fetch", fetchPdf);
  const createUrl = vi.fn(() => "blob:dashboard");
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: createUrl,
    revokeObjectURL: vi.fn(),
  }));
  const downloads: { href: string; filename: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, filename: this.download });
  });
  render(<DashboardExportButton period="last-month" />);

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export" })); });

  expect(fetchPdf).toHaveBeenCalledWith("/api/dashboard/pdf?period=last-month");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Exporting…" }).hasAttribute("disabled")).toBe(true);
  expect(downloads).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Exporting…" }));
  expect(fetchPdf).toHaveBeenCalledTimes(1);

  await act(async () => { finish(pdf); });

  expect(createUrl).toHaveBeenCalledWith(pdf);
  expect(downloads).toEqual([{ href: "blob:dashboard", filename: "dashboard-last-month-2026-10-25.pdf" }]);
  expect(screen.getByRole("button", { name: "Export" }).hasAttribute("disabled")).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  act(() => { vi.runAllTimers(); });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:dashboard");
});

it("tells Staff when the export fails and lets them retry", async () => {
  vi.useFakeTimers();
  const fetchPdf = vi.fn().mockResolvedValue(new Response("Unavailable", { status: 500 }));
  vi.stubGlobal("fetch", fetchPdf);
  render(<DashboardExportButton period="today" />);

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export" })); });

  expect(screen.getByRole("alert").textContent).toBe("Couldn't export the Dashboard. Please try again.");
  expect(screen.getByRole("button", { name: "Export" }).hasAttribute("disabled")).toBe(false);
  fetchPdf.mockReturnValue(new Promise(() => {}));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export" })); });
  expect(fetchPdf).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Exporting…" }).hasAttribute("disabled")).toBe(true);
});

it.each([
  ["a refused request", 403, "application/pdf"],
  ["a server failure", 500, "application/pdf"],
  ["a sign-in page instead of a PDF", 200, "text/html"],
])("does not download %s", async (_reason, status, contentType) => {
  vi.useFakeTimers();
  const readBody = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status === 200,
    headers: new Headers({ "content-type": contentType }),
    blob: readBody,
  }));
  render(<DashboardExportButton period="7-days" />);

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export" })); });

  expect(screen.getByRole("alert").textContent).toContain("Couldn't export the Dashboard");
  expect(readBody).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Export" }).hasAttribute("disabled")).toBe(false);
});

it.each(["network", "body"])("recovers from a %s failure", async (failure) => {
  vi.useFakeTimers();
  const error = new Error("Connection lost");
  vi.stubGlobal("fetch", failure === "network"
    ? vi.fn().mockRejectedValue(error)
    : vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      blob: vi.fn().mockRejectedValue(error),
    }));
  render(<DashboardExportButton period="90-days" />);

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export" })); });

  expect(screen.getByRole("alert").textContent).toContain("Please try again");
  expect(screen.getByRole("button", { name: "Export" }).hasAttribute("disabled")).toBe(false);
});
