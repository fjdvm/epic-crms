// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Conversation } from "@/features/tickets/conversation";
import type { ConnectLive, LiveEvent } from "@/features/tickets/live";
import type { TicketMessage } from "@/features/tickets/ticket";
import { reply } from "@/features/tickets/actions";
import { uploadFile } from "@/features/files/client";

vi.mock("@/features/tickets/actions", () => ({
  claim: vi.fn(),
  release: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
  liveUrl: vi.fn(),
}));
vi.mock("@/features/files/client", () => ({ uploadFile: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);
beforeEach(() => vi.mocked(toast.error).mockClear());

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

/** Send always asks first: the reply goes only once Staff confirm in the dialog. */
const send = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Send reply" }));
};

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
    await send();

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
    await send();

    await waitFor(() => expect(screen.getByText("Still here")).toBeTruthy());
  });

  it("asks before sending, and sends nothing if Staff back out", async () => {
    vi.mocked(reply).mockClear();
    renderConversation(fakeRelay().connect);

    await userEvent.type(screen.getByLabelText("Write a reply"), "Hold on");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(reply).not.toHaveBeenCalled();

    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(reply).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Write a reply") as HTMLTextAreaElement).value).toBe("Hold on");
  });

  it("uploads the picked image straight to storage and sends only its reference", async () => {
    vi.mocked(reply).mockClear();
    vi.mocked(uploadFile).mockReset();
    vi.mocked(uploadFile).mockResolvedValue({
      ok: true, reference: "ready-ref", filename: "box.jpg", contentType: "image/jpeg", size: 3,
    });
    vi.mocked(reply).mockResolvedValue({ ok: true, messageId: 9 });
    renderConversation(fakeRelay().connect);

    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "box.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Attach a file"), photo);
    expect(screen.getByAltText("Selected image: box.jpg")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(uploadFile).not.toHaveBeenCalled();
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(reply).toHaveBeenCalled());
    expect(uploadFile).toHaveBeenCalledWith("Tickets", photo, { ticketId: 208 });
    const form = vi.mocked(reply).mock.calls[0][1];
    expect(form.get("attachment")).toBe("ready-ref");
    expect(form.get("image")).toBeNull();
    await waitFor(() => expect(screen.queryByAltText("Selected image: box.jpg")).toBeNull());
  });

  it.each([
    ["receipt.pdf", "application/pdf"],
    ["clip.mp4", "video/mp4"],
    ["clip.mov", "video/quicktime"],
  ])("accepts %s and shows its file name as the preview", async (name, type) => {
    renderConversation(fakeRelay().connect);

    await userEvent.upload(screen.getByLabelText("Attach a file"), new File(["x"], name, { type }), { applyAccept: false });

    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText(name)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers the allowed types to the picker", () => {
    renderConversation(fakeRelay().connect);

    const accept = screen.getByLabelText("Attach a file").getAttribute("accept")!;
    for (const type of ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "video/mp4", "video/quicktime"])
      expect(accept).toContain(type);
  });

  it("says why an upload was refused and keeps what Staff wrote", async () => {
    vi.mocked(reply).mockClear();
    vi.mocked(uploadFile).mockReset();
    vi.mocked(uploadFile).mockResolvedValue({ ok: false, reason: "The file's contents do not match its claimed type. Choose the correct file." });
    renderConversation(fakeRelay().connect);

    await userEvent.type(screen.getByLabelText("Write a reply"), "See attached");
    await userEvent.upload(screen.getByLabelText("Attach a file"), new File(["x"], "fake.pdf", { type: "application/pdf" }), { applyAccept: false });
    await send();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The file's contents do not match its claimed type. Choose the correct file."));
    expect(reply).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Write a reply") as HTMLTextAreaElement).value).toBe("See attached");
    expect(screen.getByText("fake.pdf")).toBeTruthy();
  });

  it("shows the reply as sending and cannot be sent twice while it is on its way", async () => {
    vi.mocked(reply).mockClear();
    let finish!: (outcome: { ok: true; messageId: number }) => void;
    vi.mocked(reply).mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    renderConversation(fakeRelay().connect);

    await userEvent.type(screen.getByLabelText("Write a reply"), "Once only");
    await send();

    const sending = await screen.findByRole("button", { name: "Sending…" });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(sending);
    expect(reply).toHaveBeenCalledTimes(1);

    await act(async () => finish({ ok: true, messageId: 11 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(),
    );
  });

  it("clears the box once the reply is sending, and puts it back when the reply is refused", async () => {
    vi.mocked(reply).mockClear();
    let finish!: (outcome: { ok: false; reason: "unavailable" }) => void;
    vi.mocked(reply).mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    vi.mocked(uploadFile).mockResolvedValue({
      ok: true, reference: "ready-ref", filename: "box.jpg", contentType: "image/jpeg", size: 3,
    });
    renderConversation(fakeRelay().connect);

    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "box.jpg", {
      type: "image/jpeg",
    });
    await userEvent.upload(screen.getByLabelText("Attach a file"), photo);
    await userEvent.type(screen.getByLabelText("Write a reply"), "Try me");
    await send();

    await screen.findByRole("button", { name: "Sending…" });
    expect(
      (screen.getByLabelText("Write a reply") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(screen.queryByAltText("Selected image: box.jpg")).toBeNull();

    await act(async () => finish({ ok: false, reason: "unavailable" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Write a reply") as HTMLTextAreaElement).value,
      ).toBe("Try me"),
    );
    expect(screen.getByAltText("Selected image: box.jpg")).toBeTruthy();
  });

  it.each([
    ["notes.txt", "text/plain", ["x"], "Choose a JPG, PNG, GIF, WebP, PDF, MP4 or MOV file."],
    ["empty.pdf", "application/pdf", [], "That file is empty. Choose a file with something in it."],
  ])("refuses %s before uploading it", async (name, type, bytes, message) => {
    vi.mocked(uploadFile).mockReset();
    renderConversation(fakeRelay().connect);

    await userEvent.upload(screen.getByLabelText("Attach a file"), new File(bytes, name, { type }), { applyAccept: false });

    expect(toast.error).toHaveBeenCalledWith(message);
    expect(screen.queryByText(name)).toBeNull();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("refuses a file over 25 MB before uploading it", async () => {
    renderConversation(fakeRelay().connect);
    const big = new File(["x"], "big.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: 25 * 1024 * 1024 + 1 });

    await userEvent.upload(screen.getByLabelText("Attach a file"), big, { applyAccept: false });

    expect(toast.error).toHaveBeenCalledWith("That file is over 25 MB. Choose a smaller file.");
    expect(screen.queryByText("big.mp4")).toBeNull();
  });
});
