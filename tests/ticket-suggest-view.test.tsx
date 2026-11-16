// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applySuggestedField, suggestCategoryAndPriority } from "@/features/tickets/actions";
import { SuggestCard } from "@/features/tickets/suggest-card";
import type { SerializedSuggestion } from "@/features/tickets/suggest-view";

vi.mock("@/features/tickets/actions", () => ({ applySuggestedField: vi.fn(), suggestCategoryAndPriority: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const suggestion: SerializedSuggestion = {
  id: 7, model: "m", sentText: "Subject: Leak", category: "Delivery Issue", categoryReason: "Leak in transit",
  priority: "high", priorityReason: "Food safety", categoryDecision: null, priorityDecision: null, createdAt: "2026-11-16T00:00:00Z",
};

const card = (over: Partial<Parameters<typeof SuggestCard>[0]> = {}) =>
  render(<SuggestCard ticketId={1} category="Other" priority="normal" suggestion={null} canWork completed={false} {...over} />);

describe("SuggestCard", () => {
  it("asks only when Staff press Suggest, and shows the suggestion without applying it", async () => {
    vi.mocked(suggestCategoryAndPriority).mockResolvedValue({ ok: true, suggestion });
    card();
    expect(suggestCategoryAndPriority).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));

    expect(await screen.findByText("Leak in transit")).toBeTruthy();
    expect(applySuggestedField).not.toHaveBeenCalled();
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("Accept needs a confirm, then shows the new value at once", async () => {
    vi.mocked(applySuggestedField).mockReturnValue(new Promise(() => {}));
    card({ suggestion });

    await userEvent.click(screen.getAllByRole("button", { name: "Accept" })[1]);
    expect(applySuggestedField).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(applySuggestedField).toHaveBeenCalledWith(1, "priority", "high", 7, expect.any(String));
    expect(screen.getByText("High")).toBeTruthy();
  });

  it("Change applies a different value and a refusal rolls back with the reason", async () => {
    vi.mocked(applySuggestedField).mockResolvedValue({ ok: false, reason: "completed" });
    card({ suggestion });

    await userEvent.click(screen.getAllByRole("button", { name: "Change" })[0]);
    await userEvent.selectOptions(screen.getByLabelText("New Category"), "Payment Issue");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(applySuggestedField).toHaveBeenCalledWith(1, "category", "Payment Issue", 7, expect.any(String));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The Customer has completed this Ticket, so it can no longer change."));
    await waitFor(() => expect(screen.getByText("Other")).toBeTruthy());
  });

  it("a model failure says so and leaves the manual Change buttons", async () => {
    vi.mocked(suggestCategoryAndPriority).mockResolvedValue({ ok: false, reason: "model-failed" });
    card();

    await userEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));

    expect((await screen.findByRole("alert")).textContent).toContain("could not suggest");
    expect(screen.getAllByRole("button", { name: "Change" })).toHaveLength(2);
  });

  it("is read-only for Admin and CEO", () => {
    card({ canWork: false, suggestion });
    expect(screen.queryByRole("button", { name: /Suggest|Accept|Change/ })).toBeNull();
  });
});
