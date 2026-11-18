// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ProofReadFindings } from "@/features/orders/proof-read-view";
import type { ProofReadView } from "@/features/orders/proof-read";

afterEach(cleanup);

const f = (finding: "Match" | "Mismatch" | "Missing" | "Needs Review", read: string | null, expected: string | null) => ({ finding, read, expected });
const read: ProofReadView = {
  status: "read",
  flags: { reusedReferenceOrderIds: [42], reusedImageProofIds: [] },
  findings: {
    amount: f("Mismatch", "1000", "₱1,250.00"),
    date: f("Match", "2026-11-18", "after 2026-11-18"),
    reference: f("Missing", null, "5012334812"),
    recipient: f("Needs Review", "Juan D***", "Juan Dela Cruz"),
    accountNumber: f("Match", "0917 123 4567", "09171234567"),
  },
};
const item = (finding: string, i = 0) => screen.getAllByText(finding, { selector: "span" })[i].closest("li") as HTMLElement;

it("shows each finding with a plain reason, including the amount explanation", () => {
  render(<ProofReadFindings read={read} role="staff" />);
  expect(within(item("Mismatch")).getByText("Proof shows ₱1,000.00, but the order requires ₱1,250.00.")).toBeTruthy();
  expect(within(item("Missing")).getByText(/does not show the reference no\./)).toBeTruthy();
  expect(within(item("Needs Review")).getByText(/not clear enough/)).toBeTruthy();
  expect(screen.getAllByText("Match")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "Order #42" }).getAttribute("href")).toBe("/orders/42");
});

it.each(["staff", "manager", "admin", "ceo"] as const)("%s sees the findings and no control that starts a read", role => {
  render(<ProofReadFindings read={read} role={role} />);
  expect(screen.getByLabelText("Proof reader findings")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryAllByRole("link").every(l => /^\/orders\/\d+$/.test(l.getAttribute("href") ?? ""))).toBe(true);
});

it("shows Needs Review when the read failed", () => {
  render(<ProofReadFindings role="manager" read={{ status: "needs-review", flags: { reusedReferenceOrderIds: [], reusedImageProofIds: [] },
    findings: { amount: f("Needs Review", null, null), date: f("Needs Review", null, null), reference: f("Needs Review", null, null), recipient: f("Needs Review", null, null), accountNumber: f("Needs Review", null, null) } }} />);
  expect(screen.getByRole("note").textContent).toMatch(/Needs Review\. The proof could not be read/);
  expect(screen.getAllByText("Needs Review", { selector: "li span span" })).toHaveLength(5);
});

it("says the proof is not read yet when there is no result, and shows nothing without a role", () => {
  const { rerender, container } = render(<ProofReadFindings read={undefined} role="staff" />);
  expect(screen.getByText(/Not read yet/)).toBeTruthy();
  rerender(<ProofReadFindings read={read} role={null} />);
  expect(container.textContent).toBe("");
});
