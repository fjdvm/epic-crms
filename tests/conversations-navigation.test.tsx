// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inboxKey, openChatId, type ConversationRow } from "@/features/tickets/conversations";
import { ChatPane, ConversationsNavigation } from "@/features/tickets/conversations-navigation";
import { ConversationInbox } from "@/features/tickets/conversations-view";

// Never settles, as a chat the server has not answered for yet.
const push = vi.fn((_href: string) => new Promise<void>(() => {}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/features/tickets/actions", () => ({}));

afterEach(() => { cleanup(); push.mockClear(); });

const chat = (ticketId: number, customerName: string): ConversationRow => ({
  ticketId, customerName, preview: "Hello", lastActivity: new Date("2026-10-19T02:12:00Z"),
});
const chats = [chat(208, "Maria Santos"), chat(209, "Ana Cruz")];

function screenWithChats() {
  render(
    <ConversationsNavigation>
      <ConversationInbox chats={chats} selectedId={208} />
      <ChatPane><p>Chat with Maria</p></ChatPane>
    </ConversationsNavigation>,
  );

  return within(screen.getByRole("navigation", { name: "Chats" }));
}

describe("opening a chat", () => {
  it("highlights it and skeletons only the chat, keeping the inbox", async () => {
    const inbox = screenWithChats();

    fireEvent.click(inbox.getByRole("link", { name: /Ana Cruz/ }));

    expect(await screen.findByRole("status", { name: "Loading chat" })).toBeTruthy();
    expect(screen.queryByText("Chat with Maria")).toBeNull();
    expect(inbox.getByRole("link", { name: /Ana Cruz/ }).getAttribute("aria-current")).toBe("true");
    expect(inbox.getByRole("link", { name: /Maria Santos/ }).getAttribute("aria-current")).toBeNull();
    expect(push).toHaveBeenCalledWith("/conversations?ticket=209");
  });

  it("leaves a Ctrl-click to the browser", () => {
    const inbox = screenWithChats();
    const link = inbox.getByRole("link", { name: /Ana Cruz/ });
    const click = createEvent.click(link, { ctrlKey: true });
    // The component must leave it alone; jsdom cannot follow it, so stop it after React has had its turn.
    let preventedByUs = true;
    const stop = (event: Event) => { preventedByUs = event.defaultPrevented; event.preventDefault(); };
    window.addEventListener("click", stop, { once: true });
    fireEvent(link, click);

    expect(preventedByUs).toBe(false);

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("Chat with Maria")).toBeTruthy();
  });

  it("does nothing new on the chat already open", () => {
    const inbox = screenWithChats();

    fireEvent.click(inbox.getByRole("link", { name: /Maria Santos/ }));

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("Chat with Maria")).toBeTruthy();
  });
});

describe("what reloads the inbox", () => {
  it("is the tab and the search, never the open chat", () => {
    expect(inboxKey({ ticket: "208" })).toBe(inboxKey({ ticket: "209" }));
    expect(inboxKey({ ticket: "208" })).toBe(inboxKey({}));
    expect(inboxKey({ tab: "all", ticket: "208" })).not.toBe(inboxKey({ ticket: "208" }));
    expect(inboxKey({ q: "ana" })).not.toBe(inboxKey({}));
  });
});

describe("which chat is open", () => {
  it("is the one asked for, else the newest; only Manager-level Roles and Admin open one outside the list", () => {
    expect(openChatId(chats, 209, false)).toBe(209);
    expect(openChatId(chats, undefined, false)).toBe(208);
    expect(openChatId(chats, 999, false)).toBe(208);
    expect(openChatId(chats, 999, true)).toBe(999);
    expect(openChatId([], undefined, true)).toBeUndefined();
  });
});
