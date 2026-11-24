// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { UnusualActivityCards } from "@/features/dashboard/unusual-activity-cards";

const card = (key: string, rule: string) => ({
  key, module: "Payments", rule, numbers: { count: 7, oldestHours: 30 }, urgency: 2,
  links: [{ label: "Order #12", href: "/orders/12" }, { label: "Order #13", href: "/orders/13" }],
});
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const fetchMock = vi.fn();

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => { cleanup(); fetchMock.mockReset(); vi.unstubAllGlobals(); });

it("shows a skeleton at once, then each card with its rule, numbers and links", async () => {
  fetchMock.mockReturnValue(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  render(<UnusualActivityCards canDismiss canExplain={false} />);
  expect(screen.getByRole("status", { name: /loading unusual activity/i })).toBeTruthy();
  expect(await screen.findByText("Rule A")).toBeTruthy();
  expect(screen.getByText(/count: 7/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Order #12" }).getAttribute("href")).toBe("/orders/12");
});

it("shows nothing when there are no cards", async () => {
  fetchMock.mockReturnValue(json({ cards: [], unavailable: [] }));
  const { container } = render(<UnusualActivityCards canDismiss canExplain={false} />);
  await waitFor(() => expect(container.innerHTML).toBe(""));
});

it("shows the empty state it is given when there are no cards", async () => {
  fetchMock.mockReturnValue(json({ cards: [], unavailable: [] }));
  render(<UnusualActivityCards canDismiss canExplain={false} emptyState={<p>No unusual activity right now.</p>} />);
  expect(await screen.findByText("No unusual activity right now.")).toBeTruthy();
});

it("hides a card at once on Dismiss and posts the numbers the person saw", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [card("a", "Rule A"), card("b", "Rule B")], unavailable: [] }));
  let release!: () => void;
  fetchMock.mockReturnValueOnce(new Promise(r => { release = () => r(new Response(JSON.stringify({ ok: true }))); }));
  render(<UnusualActivityCards canDismiss canExplain={false} />);
  await userEvent.click(await screen.findByRole("button", { name: /dismiss: rule a/i }));
  expect(screen.queryByText("Rule A")).toBeNull();
  expect(screen.getByText("Rule B")).toBeTruthy();
  const [, init] = fetchMock.mock.calls[1];
  expect(init.headers["x-creoms-alert-dismiss"]).toBe("1");
  expect(JSON.parse(init.body)).toEqual({ key: "a", numbers: { count: 7, oldestHours: 30 } });
  release();
});

it("rolls back with the server's plain reason when Dismiss is refused", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  fetchMock.mockReturnValueOnce(json({ ok: false, reason: "This Unusual activity card changed." }, 409));
  render(<UnusualActivityCards canDismiss canExplain={false} />);
  await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
  expect((await screen.findByRole("alert")).textContent).toBe("This Unusual activity card changed.");
  expect(screen.getByText("Rule A")).toBeTruthy();
});

it("rolls back with a plain reason when the network fails", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  render(<UnusualActivityCards canDismiss canExplain={false} />);
  await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/try again/i);
  expect(screen.getByText("Rule A")).toBeTruthy();
});

it("offers no Dismiss to a Role that can only view", async () => {
  fetchMock.mockReturnValue(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  render(<UnusualActivityCards canDismiss={false} />);
  await screen.findByText("Rule A");
  expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
});

it("asks once for a missing explanation, shows it, and asks for none that are kept", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [card("a", "Rule A"), { ...card("b", "Rule B"), explanation: { why: "Kept why", whatToDo: null } }], unavailable: [] }));
  fetchMock.mockReturnValueOnce(json({ explanation: { why: "Because 7 wait.", whatToDo: "Check them." } }));
  render(<UnusualActivityCards canDismiss />);
  expect(await screen.findByText(/Because 7 wait/)).toBeTruthy();
  expect(screen.getByText(/Kept why/)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe("/api/dashboard/unusual-activity/explain");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ key: "a" });
});

it("leaves the card showing when the explanation fails, and never asks for a view-only Role", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  render(<UnusualActivityCards canDismiss />);
  expect(await screen.findByText("Rule A")).toBeTruthy();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Why:/)).toBeNull();
  fetchMock.mockReset();
  fetchMock.mockReturnValue(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  render(<UnusualActivityCards canDismiss={false} />);
  await screen.findAllByText("Rule A");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("opens a drawer at once with the rule, numbers, AI-written labels and links", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [{ ...card("a", "Rule A"), explanation: { why: "Because 7 wait.", whatToDo: "Check them." } }], unavailable: [] }));
  render(<UnusualActivityCards canDismiss />);
  await userEvent.click(await screen.findByRole("button", { name: /open details: rule a/i }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toMatch(/Why \(AI-written, check before acting\)/);
  expect(dialog.textContent).toMatch(/Because 7 wait/);
  expect(dialog.textContent).toMatch(/Check them/);
  expect(dialog.textContent).toMatch(/oldest hours/i);
  expect(dialog.querySelector('a[href="/orders/12"]')).toBeTruthy();
});

it("still shows the rule and links in the drawer when no explanation was made", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  render(<UnusualActivityCards canDismiss canExplain={false} />);
  await userEvent.click(await screen.findByRole("button", { name: /open details: rule a/i }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toMatch(/No explanation yet/);
  expect(dialog.querySelector('a[href="/orders/13"]')).toBeTruthy();
});

it("shows a loading state in the drawer while the explanation is being made", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  fetchMock.mockReturnValueOnce(new Promise(() => {}));
  render(<UnusualActivityCards canDismiss />);
  await userEvent.click(await screen.findByRole("button", { name: /open details: rule a/i }));
  expect(await screen.findByRole("status", { name: /loading explanation/i })).toBeTruthy();
});

it("is read-only for a Role that cannot dismiss", async () => {
  fetchMock.mockReturnValueOnce(json({ cards: [card("a", "Rule A")], unavailable: [] }));
  render(<UnusualActivityCards canDismiss={false} />);
  await userEvent.click(await screen.findByRole("button", { name: /open details: rule a/i }));
  await screen.findByRole("dialog");
  expect(screen.queryByRole("button", { name: /dismiss alert/i })).toBeNull();
});
