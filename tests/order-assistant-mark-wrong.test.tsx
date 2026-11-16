// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AssistantLoading from "@/app/(app)/tickets/assistant/loading";
import ResultsLoading from "@/app/(app)/tickets/assistant/results/loading";
import { MarkWrong } from "@/features/order-assistant/mark-wrong";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/features/order-assistant/actions", () => ({ markWrong: save }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  save.mockReset();
});
it("shows the optimistic flag immediately, then rolls back with the server refusal", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let finish!: (value: { ok: boolean; reason: string }) => void;
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<MarkWrong ticketId={1} messageId={2} />);
  fireEvent.click(screen.getByText("Mark wrong"));
  fireEvent.change(screen.getByLabelText("Why is this answer wrong?"), {
    target: { value: "Incorrect status" },
  });
  fireEvent.click(screen.getByText("Save reason"));
  expect(screen.getByRole("status").textContent).toBe("Marked wrong");
  finish({ ok: false, reason: "This answer has already been marked wrong." });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "already been marked wrong",
    ),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByDisplayValue("Incorrect status")).toBeTruthy();
});
it("does not save when confirmation is cancelled", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<MarkWrong ticketId={1} messageId={2} />);
  fireEvent.click(screen.getByText("Mark wrong"));
  fireEvent.change(screen.getByLabelText("Why is this answer wrong?"), {
    target: { value: "Incorrect" },
  });
  fireEvent.click(screen.getByText("Save reason"));
  expect(save).not.toHaveBeenCalled();
});

it.each([AssistantLoading, ResultsLoading])(
  "renders the new page loading state immediately",
  (Loading) => {
    render(<Loading />);
    expect(
      screen.getByRole("status", { name: "Loading Order assistant" }),
    ).toBeTruthy();
  },
);
