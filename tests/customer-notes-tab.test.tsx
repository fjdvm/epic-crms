// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { NotesTab, type VisibleCustomerNote } from "@/features/customer-profiles/notes-tab";
import type { AddCustomerNoteResult } from "@/features/customer-profiles/note-actions";

const add = vi.fn();
vi.mock("@/features/customer-profiles/note-actions", () => ({ addCustomerNote: (...args: unknown[]) => add(...args) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function View() {
  const [notes, setNotes] = useState<VisibleCustomerNote[]>([]);
  return <NotesTab customerId="customer-1" notes={notes} author={{ id: "staff-1", name: "Rhea" }}
    onNoteChange={(id, note) => setNotes(old => [...old.filter(n => n.id !== id), ...(note ? [note] : [])])} />;
}
it("confirms before adding, shows saving immediately, and rolls back with the refusal", async () => {
  let finish!: (result: AddCustomerNoteResult) => void;
  add.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<View />);
  expect(screen.getByText("No Customer notes yet")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Customer note" }), { target: { value: "Prefers pickup on Saturdays" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(add).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save note" }));
  expect(screen.getByText("saving…")).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Customer notes" })).getByText("Prefers pickup on Saturdays")).toBeTruthy();
  await act(async () => finish({ ok: false, message: "Your Role can only view shop work." }));
  expect(screen.queryByText("saving…")).toBeNull();
  expect(screen.queryByRole("list", { name: "Customer notes" })).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Your Role can only view shop work.");
  expect(screen.getByText("No Customer notes yet")).toBeTruthy();
});

it("rejects blank and over-limit text and counts Unicode characters", () => {
  render(<View />);
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(screen.getByRole("alert").textContent).toContain("Write a Customer note before saving.");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "😀".repeat(2001) } });
  expect(screen.getByText("2,001 / 2,000")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  expect(screen.getByRole("alert").textContent).toContain("at most 2,000 characters");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(add).not.toHaveBeenCalled();
});

it("cancels without saving and preserves the draft", () => {
  render(<View />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "A correction" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(add).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A correction");
});

it("retries a transport failure with the same operation and replaces saving with the saved note", async () => {
  add.mockRejectedValueOnce(new Error("Lost response"));
  add.mockResolvedValueOnce({ ok: true, note: { id: "saved", customerId: "customer-1", authorId: "staff-1", authorName: "Rhea", text: "Pickup", createdAt: "2026-11-16T00:00:00.000Z" } });
  render(<View />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Pickup" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save note" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save note" })));
  expect(add.mock.calls[0]).toEqual(add.mock.calls[1]);
  expect(screen.queryByText("saving…")).toBeNull();
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
});

it("shows a skeleton immediately while notes load, and distinguishes an unavailable read", () => {
  const { rerender } = render(<NotesTab customerId="c" notes={undefined} onNoteChange={() => {}} />);
  expect(screen.getByRole("status", { name: "Loading Customer notes" })).toBeTruthy();
  rerender(<NotesTab customerId="c" notes={null} onNoteChange={() => {}} />);
  expect(screen.getByRole("alert").textContent).toContain("Customer notes are unavailable");
  expect(screen.queryByText("No Customer notes yet")).toBeNull();
});

it("shows notes newest first with author and date, without write controls for read-only viewers", () => {
  render(<NotesTab customerId="c" notes={[
    { id: "old", customerId: "c", authorId: "r", authorName: "Rhea", text: "Older", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "new", customerId: "c", authorId: "b", authorName: "Bernice", text: "Newest", createdAt: "2026-11-01T00:00:00.000Z" },
  ]} onNoteChange={() => {}} />);
  expect(screen.getByText("Only staff can see these")).toBeTruthy();
  const rows = screen.getAllByRole("listitem");
  expect(rows[0].textContent).toContain("Bernice · 1 Nov 2026Newest");
  expect(rows[1].textContent).toContain("Rhea · 1 Jan 2026Older");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save note" })).toBeNull();
});
