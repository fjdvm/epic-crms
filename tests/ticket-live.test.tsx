// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Conversation } from "@/features/tickets/conversation";
import type { ConnectLive, LiveEvent } from "@/features/tickets/live";
import type { TicketMessage } from "@/features/tickets/ticket";
import { reply } from "@/features/tickets/actions";

vi.mock("@/features/tickets/actions", () => ({
  claim: vi.fn(),
  release: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
  liveUrl: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

/** A fake at the Live ticket boundary: tests push events in and read the frames sent out. */
function fakeRelay() {
  const sent: unknown[] = [];
  let handlers: Parameters<ConnectLive>[1] | undefined;
  const connect: ConnectLive = (_ticketId, h) => {
    handlers = h;
    queueMicrotask(h.onOpen);

    return { send: (frame) => void sent.push(frame), close: () => {} };
  };

  return {
    connect,
    sent,
    receive: (event: LiveEvent) => act(() => handlers!.onEvent(event)),
    drop: () => act(() => handlers!.onClose()),
  };
}

const saved: TicketMessage[] = [
  {
    id: 1,
    sender: "customer",
    senderName: "Maria",
    body: "One of the halaya pouches was leaking.",
    hasAttachment: false,
    createdAt: new Date("2026-10-19T02:12:00Z"),
  },
];

const renderConversation = (
  connect: ConnectLive,
  props: { canReply?: boolean } = {},
) =>
  render(
    <Conversation
      ticketId={208}
      messages={saved}
      viewerName="Bernice"
      customerName="Maria"
      canReply={props.canReply ?? true}
      note="Not yours"
      connect={connect}
    />,
  );

const fromCustomer = (id: number, text: string): LiveEvent => ({
  type: "message",
  id: String(id),
  from: { userId: "c1", role: "Customer" },
  text,
  sentAt: "2026-10-19T02:30:00Z",
});

beforeEach(() => vi.clearAllMocks());

describe("live Conversation", () => {
  it("shows a Customer Message as it arrives, without a refresh", async () => {
    const relay = fakeRelay();
    renderConversation(relay.connect);

    await relay.receive(
      fromCustomer(2, "Replacement please, it is for Undas."),
    );

    expect(
      screen.getByText("Replacement please, it is for Undas."),
    ).toBeTruthy();
  });

  it("shows a Message that is both live and saved once", async () => {
    const relay = fakeRelay();
    renderConversation(relay.connect);

    await relay.receive(
      fromCustomer(1, "One of the halaya pouches was leaking."),
    );

    expect(
      screen.getAllByText("One of the halaya pouches was leaking."),
    ).toHaveLength(1);
  });

  it("relays a saved reply and shows it", async () => {
    const relay = fakeRelay();
    vi.mocked(reply).mockResolvedValue({ ok: true, messageId: 7 });
    renderConversation(relay.connect);

    await userEvent.type(screen.getByLabelText("Write a reply"), "On it!");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("On it!")).toBeTruthy());
    expect(relay.sent).toEqual([{ type: "message", id: "7", text: "On it!" }]);
  });

  it("keeps a reply that could not be relayed", async () => {
    vi.mocked(reply).mockResolvedValue({ ok: true, messageId: 8 });
    const connect: ConnectLive = () => ({
      send: () => {
        throw new Error("down");
      },
      close: () => {},
    });
    renderConversation(connect);

    await userEvent.type(screen.getByLabelText("Write a reply"), "Still here");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Still here")).toBeTruthy());
  });

  it("sends the picked image with the reply", async () => {
    vi.mocked(reply).mockClear();
    vi.mocked(reply).mockResolvedValue({ ok: true, messageId: 9 });
    renderConversation(fakeRelay().connect);

    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "box.jpg", {
      type: "image/jpeg",
    });
    await userEvent.upload(screen.getByLabelText("Attach an image"), photo);
    expect(screen.getByAltText("Selected image: box.jpg")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(reply).toHaveBeenCalled());
    const form = vi.mocked(reply).mock.calls[0][1];
    expect((form.get("image") as File).name).toBe("box.jpg");
    await waitFor(() =>
      expect(screen.queryByAltText("Selected image: box.jpg")).toBeNull(),
    );
  });

  it("shows the reply as sending and cannot be sent twice while it is on its way", async () => {
    vi.mocked(reply).mockClear();
    let finish!: (outcome: { ok: true; messageId: number }) => void;
    vi.mocked(reply).mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    renderConversation(fakeRelay().connect);

    await userEvent.type(screen.getByLabelText("Write a reply"), "Once only");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    const sending = await screen.findByRole("button", { name: "Sending…" });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(sending);
    expect(reply).toHaveBeenCalledTimes(1);

    await act(async () => finish({ ok: true, messageId: 11 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(),
    );
  });

  it("refuses a file that is not a JPG or PNG before sending it", async () => {
    vi.mocked(reply).mockClear();
    renderConversation(fakeRelay().connect);

    const pdf = new File(["%PDF"], "receipt.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Attach an image"), pdf, {
      applyAccept: false,
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Only JPG or PNG images can be attached.",
    );
    expect(screen.queryByText("receipt.pdf")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
