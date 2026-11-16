// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftDisabledReason } from "@/features/tickets/draft";
import { DraftPanel } from "@/features/tickets/draft-panel";
import { requestDraftedReply } from "@/features/tickets/actions";

vi.mock("@/features/tickets/actions", () => ({ requestDraftedReply: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const ok = (text: string, id = 7) => ({ ok: true as const, draft: { id, text, sentText: "", systemPrompt: "", language: "Taglish" as const } });

function Harness({ initial = "", reason = null }: { initial?: string; reason?: string | null }) {
  const [text, setText] = useState(initial);
  return <><DraftPanel ticketId={1} disabledReason={reason} replyText={text} onUse={(t) => setText(t)} /><output aria-label="box">{text}</output></>;
}

describe("Draft panel", () => {
  it("requests nothing until asked, shows a loading state at once, and says nothing is sent", async () => {
    let resolve!: (v: ReturnType<typeof ok>) => void;
    vi.mocked(requestDraftedReply).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    render(<Harness />);
    expect(requestDraftedReply).not.toHaveBeenCalled();
    expect(screen.getByText("Nothing is sent until you press Send in the conversation.")).toBeTruthy();
    fireEvent.click(screen.getByText("English"));
    fireEvent.click(screen.getByText("Draft a reply"));
    expect(screen.getByRole("status", { name: "Making a draft" })).toBeTruthy();
    expect(requestDraftedReply).toHaveBeenCalledWith(1, { language: "English" });
    resolve(ok("Hello"));
    expect(await screen.findByText("Hello")).toBeTruthy();
  });

  it("fills an empty reply box without a confirm", async () => {
    vi.mocked(requestDraftedReply).mockResolvedValue(ok("Hi po") as never);
    render(<Harness />);
    fireEvent.click(screen.getByText("Draft a reply"));
    fireEvent.click(await screen.findByText("Use in conversation"));
    expect(screen.getByLabelText("box").textContent).toBe("Hi po");
  });

  it("never overwrites typed text without a confirm; keeping leaves it alone", async () => {
    vi.mocked(requestDraftedReply).mockResolvedValue(ok("Hi po") as never);
    render(<Harness initial="my own words" />);
    fireEvent.click(screen.getByText("Draft a reply"));
    fireEvent.click(await screen.findByText("Use in conversation"));
    expect(screen.getByLabelText("box").textContent).toBe("my own words");
    fireEvent.click(screen.getByText("Keep my text"));
    expect(screen.getByLabelText("box").textContent).toBe("my own words");
    fireEvent.click(screen.getByText("Use in conversation"));
    fireEvent.click(screen.getByText("Replace with draft"));
    await waitFor(() => expect(screen.getByLabelText("box").textContent).toBe("Hi po"));
  });

  it("keeps the earlier draft and says why when Make shorter is refused; Discard clears", async () => {
    vi.mocked(requestDraftedReply).mockResolvedValueOnce(ok("Long draft") as never)
      .mockResolvedValueOnce({ ok: false, reason: "The draft was not shorter." } as never);
    render(<Harness />);
    fireEvent.click(screen.getByText("Draft a reply"));
    fireEvent.click(await screen.findByText("Make shorter"));
    expect(await screen.findByText("The draft was not shorter.")).toBeTruthy();
    expect(requestDraftedReply).toHaveBeenLastCalledWith(1, { language: "Taglish", shorterThanId: 7 });
    expect(screen.getByText("Long draft")).toBeTruthy();
    fireEvent.click(screen.getByText("Discard"));
    expect(screen.queryByText("Long draft")).toBeNull();
  });

  it("is disabled with the reason when unclaimed or not Open", () => {
    expect(draftDisabledReason("open", true)).toBeNull();
    expect(draftDisabledReason("open", false)).toMatch(/Claim this Ticket/);
    expect(draftDisabledReason("on_hold", true)).toMatch(/Open/);
    expect(draftDisabledReason("resolved", true)).toMatch(/Open/);
    render(<Harness reason="Claim this Ticket to ask for a draft." />);
    expect((screen.getByText("Draft a reply") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Claim this Ticket to ask for a draft.")).toBeTruthy();
    fireEvent.click(screen.getByText("Draft a reply"));
    expect(requestDraftedReply).not.toHaveBeenCalled();
  });

  it("shows a plain message when the request throws", async () => {
    vi.mocked(requestDraftedReply).mockRejectedValue(new Error("offline"));
    render(<Harness />);
    fireEvent.click(screen.getByText("Draft a reply"));
    expect(await screen.findByText(/You can still write your reply by hand/)).toBeTruthy();
  });
});

describe("server/client boundary", () => {
  it("keeps draftDisabledReason in a module the server view can call (it 500ed /conversations in production)", async () => {
    const { readFileSync } = await import("node:fs");
    const view = readFileSync("features/tickets/conversations-view.tsx", "utf8");
    const draft = readFileSync("features/tickets/draft.ts", "utf8");
    expect(draft).not.toMatch(/^["']use client["']/);
    expect(view).toMatch(/import \{ draftDisabledReason \} from "\.\/draft";/);
  });
});
