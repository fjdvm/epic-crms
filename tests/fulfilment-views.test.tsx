// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverOrder, dispatchOrder, startPreparing } from "@/features/orders/actions";
import { importDeliveryPhotoLink } from "@/features/files/actions";
import Loading from "@/app/(app)/fulfilment/loading";
import { allowsDrop, FulfilmentBoardView } from "@/features/orders/fulfilment-board";
import type { FulfilmentBoard, FulfilmentOrder } from "@/features/orders/fulfilment";
import { OrderDetailView } from "@/features/orders/order-detail";
import type { OrderDetail } from "@/features/orders/orders";

const refresh = vi.fn();
vi.mock("@/features/files/client", () => ({ uploadFile: vi.fn(async () => ({ ok: true, reference: "confirmed-image" })) }));
vi.mock("@/features/files/actions", () => ({ importDeliveryPhotoLink: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({
  quoteDeliveryFee: vi.fn(),
  cancelOrder: vi.fn(),
  startPreparing: vi.fn(),
  loadPackingSlip: vi.fn(),
  dispatchOrder: vi.fn(),
  deliverOrder: vi.fn(),
}));
/** jsdom has no layout to drag across, so tests hand the real board the drop the library would report. */
const drag = vi.hoisted(() => ({ end: null as unknown as (result: unknown) => void }));
vi.mock("@hello-pangea/dnd", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hello-pangea/dnd")>();
  return {
    ...real,
    DragDropContext: (props: React.ComponentProps<typeof real.DragDropContext>) => {
      drag.end = props.onDragEnd as (result: unknown) => void;
      return <real.DragDropContext {...props} />;
    },
  };
});
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const card = (overrides: Partial<FulfilmentOrder>): FulfilmentOrder => ({
  id: 1042,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  customerId: "c1",
  customerName: "Maria Santos",
  lines: [{ product: "Smooth tub", quantity: 2 }, { product: "Powder", quantity: 1 }],
  total: 115_000,
  status: "paid",
  paymentLabel: "Paid",
  fulfillmentMethod: "delivery",
  paymentMethod: "gcash",
  deliveredAt: null,
  packedBy: null,
  failedOpen: false,
  ...overrides,
});

type Columns = Partial<Record<"ready" | "preparing" | "dispatched" | "delivered", FulfilmentOrder[]>>;

/** Renders the board on its default All active tab; the keys only group Orders for readability. */
function board(columns: Columns) {
  const value: FulfilmentBoard = { orders: Object.values(columns).flat() };
  return render(<FulfilmentBoardView board={value} />);
}

const png = (name = "delivered.png") => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
const choosePhoto = (dialog: HTMLElement, file: File) =>
  fireEvent.change(within(dialog).getByLabelText("Delivery photo"), { target: { files: [file] } });

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}\\d`) }));
const cardFor = (id: number) => screen.getByRole("link", { name: `#${id}` }).closest("[data-fulfilment-card]") as HTMLElement;
const column = (name: string) => screen.getByRole("region", { name });
const links = (el: HTMLElement) => within(el).queryAllByRole("link").map((l) => l.textContent);
const dropOn = (id: number, from: string, to: string | null) =>
  act(() => drag.end({ draggableId: String(id), source: { droppableId: from, index: 0 }, destination: to && { droppableId: to, index: 0 } }));

describe("the Fulfilment board", () => {
  it("has the seven tabs with their counts, named in screen wording", () => {
    board({
      ready: [card({ id: 1 }), card({ id: 2, status: "confirmed", paymentMethod: "cash-on-delivery", paymentLabel: "Unpaid" })],
      preparing: [card({ id: 3, status: "preparing" })],
    });

    const names = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names).toEqual(["All active3", "To pack2", "Preparing1", "Out for delivery0", "Failed0", "Completed0", "All3"]);
    for (const old of ["Waiting for rider", "Packed", "Shipped"]) {
      expect(screen.queryByRole("tab", { name: new RegExp(`^${old}`) })).toBeNull();
    }
  });

  it("opens the Order from anywhere on its card; the failed-delivery link keeps its own target", () => {
    board({ dispatched: [card({ id: 5, status: "dispatched", failedOpen: true })] });
    tab("All");
    const c = cardFor(5);
    expect(c.className).toContain("relative");
    expect(within(c).getByRole("link", { name: "#5" }).className).toContain("after:inset-0");
    expect(within(c).getByRole("link", { name: /Failed delivery/ }).className).toContain("z-10");
  });

  it("filters the same Orders by tab: Failed also on Out for delivery, Completed apart from the rest", () => {
    board({
      ready: [card({ id: 1 })],
      dispatched: [card({ id: 3, status: "dispatched" }), card({ id: 5, status: "dispatched", failedOpen: true })],
      delivered: [card({ id: 4, status: "delivered", deliveredAt: new Date("2026-10-21T00:00:00Z") })],
    });

    tab("To pack");
    expect(screen.getByRole("link", { name: "#1" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "#3" })).toBeNull();
    tab("Out for delivery");
    expect(screen.getByRole("link", { name: "#3" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "#5" })).toBeTruthy();
    tab("Failed");
    expect(screen.queryByRole("link", { name: "#3" })).toBeNull();
    expect(screen.getByRole("link", { name: "#5" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Failed delivery/ }).getAttribute("href")).toBe("/orders/5/failed-delivery");
    tab("Completed");
    expect(screen.getByRole("link", { name: "#4" })).toBeTruthy();
    tab("All active");
    expect(within(column("Completed")).getByRole("link", { name: "#4" })).toBeTruthy();
    tab("All");
    expect(screen.getByRole("link", { name: "#4" })).toBeTruthy();
  });

  it("uses the screen wording Out for delivery", () => {
    board({
      dispatched: [card({ id: 3, status: "dispatched" })],
    });
    expect(within(cardFor(3)).getByText("Out for delivery")).toBeTruthy();
    expect(column("Out for delivery")).toBeTruthy();
    expect(screen.queryByText("Dispatched")).toBeNull();
  });

  it("shows each card's number, status, Customer, items and how it is fulfilled and paid, and links to its Order", () => {
    board({ ready: [card({})] });

    expect(screen.getByRole("link", { name: "#1042" }).getAttribute("href")).toBe("/orders/1042");
    const el = cardFor(1042);
    expect(within(el).getByText("Paid")).toBeTruthy();
    expect(within(el).getByText("Maria Santos")).toBeTruthy();
    expect(within(el).getByText("Smooth tub ×2, Powder ×1")).toBeTruthy();
    expect(within(el).getByText("Delivery · GCash")).toBeTruthy();
  });

  it("shows when a delivered Order was delivered", () => {
    board({ delivered: [card({ status: "delivered", deliveredAt: new Date("2026-10-21T03:00:00Z") })] });
    tab("Completed");

    expect(within(cardFor(1042)).getByText("Delivered 21 Oct 2026")).toBeTruthy();
  });

  it("offers each card only its next move, and none once delivered", () => {
    board({
      ready: [card({ id: 1 })],
      preparing: [card({ id: 2, status: "preparing" })],
      dispatched: [card({ id: 3, status: "dispatched" })],
      delivered: [card({ id: 4, status: "delivered", deliveredAt: new Date("2026-10-21T00:00:00Z") })],
    });

    tab("All");
    const buttons = (id: number) => within(cardFor(id)).queryAllByRole("button").map((b) => b.textContent);
    expect(buttons(1)).toEqual(["Pack order"]);
    expect(buttons(2)).toEqual(["Mark as dispatched"]);
    expect(buttons(3)).toEqual(["Mark as delivered"]);
    expect(buttons(4)).toEqual([]);
  });

  it("says so when a column is empty", () => {
    board({});
    tab("Preparing");

    expect(screen.getByText("No Orders here.")).toBeTruthy();
  });

  it("asks for no courier on a delivery, but a dispatch asks for the booking", () => {
    board({
      preparing: [card({ id: 3, status: "preparing" })],
      dispatched: [card({ id: 2, status: "dispatched" })],
    });
    for (const id of [2]) {
      fireEvent.click(within(cardFor(id)).getByRole("button", { name: "Mark as delivered" }));
      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).queryAllByRole("textbox")).toHaveLength(0);
      expect(within(dialog).queryAllByLabelText(/courier|link/i)).toHaveLength(0);
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    }
    fireEvent.click(within(cardFor(3)).getByRole("button", { name: "Mark as dispatched" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("radio", { name: "Lalamove" })).toBeTruthy();
    expect(within(dialog).getByLabelText("Booking share link (optional)")).toBeTruthy();
    for (const label of ["Rider name (optional)", "Rider contact (optional)", "Plate no. (optional)"]) expect(within(dialog).getByLabelText(label)).toBeTruthy();
  });
});

/** A Server Action the test settles by hand, so what shows while it runs can be checked. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

const moved = (id: number, status: string) => ({ ok: true as const, order: { id, status, deliveryFeeInCentavos: null } });

describe("moving an Order on the board", () => {
  it("asks before starting preparation, and sends nothing if Staff cancel", () => {
    board({ ready: [card({})] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Pack order" }));

    const dialog = screen.getByRole("alertdialog", { name: "Pack Order #1042?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(startPreparing).not.toHaveBeenCalled();
  });

  it("sends the typed COD amount with a delivery, and cannot confirm an unreadable one", async () => {
    vi.mocked(deliverOrder).mockResolvedValue(moved(1042, "delivered"));
    board({ dispatched: [card({ status: "dispatched", paymentMethod: "cash-on-delivery", total: 115_000 })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" }));
    const dialog = screen.getByRole("alertdialog");
    const amount = within(dialog).getByLabelText("Payment collected (₱)") as HTMLInputElement;
    expect(amount.value).toBe("1150.00");
    fireEvent.change(amount, { target: { value: "abc" } });
    expect((within(dialog).getByRole("button", { name: "Mark as delivered" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("marks an Order delivered following the Figma dialog, saying the store emails the Customer and asks for Feedback", async () => {
    vi.mocked(deliverOrder).mockResolvedValue(moved(1042, "delivered"));
    board({ dispatched: [card({ status: "dispatched" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" }));

    const dialog = screen.getByRole("alertdialog", { name: "Mark Order #1042 as delivered?" });
    expect(within(dialog).getByText(/Feedback request/)).toBeTruthy();
    const photo = png();
    choosePhoto(dialog, photo);
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as delivered" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 delivered."));
    expect(deliverOrder).toHaveBeenCalledTimes(1);
    const [id, form] = vi.mocked(deliverOrder).mock.calls[0];
    expect(id).toBe(1042);
    expect(form?.getAll("photo")).toEqual(["confirmed-image"]);
  });

  it("cannot confirm delivery until a Delivery photo is chosen, and says so", () => {
    board({ dispatched: [card({ status: "dispatched" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" }));
    const dialog = screen.getByRole("alertdialog");

    expect(within(dialog).getByText(/Delivery photo/)).toBeTruthy();
    expect(within(dialog).getByText("JPG or PNG, up to 5 MB")).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Mark as delivered" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(deliverOrder).not.toHaveBeenCalled();
  });

  it("previews the chosen photo before confirming, and lets Staff remove it", () => {
    board({ dispatched: [card({ status: "dispatched" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" }));
    const dialog = screen.getByRole("alertdialog");

    choosePhoto(dialog, png("door.png"));

    expect((within(dialog).getByAltText("Preview of door.png") as HTMLImageElement).src).toBe("blob:preview");
    expect((within(dialog).getByRole("button", { name: "Mark as delivered" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove door.png" }));
    expect(within(dialog).queryByAltText("Preview of door.png")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Mark as delivered" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ["a file that is not a JPG or PNG", new File(["%PDF"], "slip.pdf", { type: "application/pdf" }), "Only JPG or PNG images can be attached."],
    ["an empty file", new File([], "empty.png", { type: "image/png" }), "That image is empty. Choose a JPG or PNG with something in it."],
    [
      "a file over 5 MB",
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }),
      "That image is over 5 MB. Choose a smaller JPG or PNG.",
    ],
  ])("refuses %s clearly inside the dialog and keeps confirm disabled", (_name, file, message) => {
    board({ dispatched: [card({ status: "dispatched" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" }));
    const dialog = screen.getByRole("alertdialog");

    choosePhoto(dialog, file);

    expect(within(dialog).getByRole("alert").textContent).toBe(message);
    expect(within(dialog).queryByRole("img")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Mark as delivered" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears a refusal once a good photo is chosen", () => {
    board({ dispatched: [card({ status: "dispatched" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" }));
    const dialog = screen.getByRole("alertdialog");

    choosePhoto(dialog, new File([], "empty.png", { type: "image/png" }));
    choosePhoto(dialog, png());

    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("shows the Order packed at once, and rolls it back with the reason on refusal", async () => {
    const pending = deferred<Awaited<ReturnType<typeof startPreparing>>>();
    vi.mocked(startPreparing).mockReturnValue(pending.promise);
    board({ ready: [card({})] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Pack order" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Pack order" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(cardFor(1042)).getByRole("button", { name: "Mark as dispatched" })).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () => pending.settle({ ok: false, reason: "IMS deduction could not be confirmed. Refresh before retrying." }));
    expect(toast.error).toHaveBeenCalledWith("IMS deduction could not be confirmed. Refresh before retrying.");
    await waitFor(() => expect(within(cardFor(1042)).getByRole("button", { name: "Pack order" })).toBeTruthy());
  });

  it("shows who packed an Order on its board card", () => {
    board({ preparing: [card({ status: "preparing", packedBy: { name: "Liza B." } })] });
    expect(within(cardFor(1042)).getByText("Packed by Liza B.")).toBeTruthy();
  });

  it("packs once the server confirms", async () => {
    vi.mocked(startPreparing).mockResolvedValue(moved(1042, "preparing"));
    board({ ready: [card({})] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Pack order" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Pack order" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 packed."));
    expect(startPreparing).toHaveBeenCalledWith(1042);
  });

  it("shows a refusal's reason and leaves the card where it was", async () => {
    const reason = "Only a dispatched Order can be delivered; it may have already changed. Refresh it before trying again.";
    vi.mocked(deliverOrder).mockResolvedValue({ ok: false, reason });
    board({ dispatched: [card({ status: "dispatched" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" }));
    choosePhoto(screen.getByRole("alertdialog"), png());
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark as delivered" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
    expect(toast.success).not.toHaveBeenCalled();
    tab("Out for delivery");
    await waitFor(() => expect(screen.getByRole("link", { name: "#1042" })).toBeTruthy());
    expect(refresh).toHaveBeenCalled();
  });

  const openDelivery = () => {
    board({ dispatched: [card({ status: "dispatched" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Paste image link" }));
    return dialog;
  };
  const confirmButton = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Mark as delivered" }) as HTMLButtonElement;

  it("accepts the Lalamove or Grab image link as the proof instead of an upload, and enables confirm only for an https link", () => {
    const dialog = openDelivery();
    expect(within(dialog).getByText("Proof of delivery (required)")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Delivery photo")).toBeNull();
    expect(confirmButton(dialog).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Delivery photo link"), { target: { value: "http://share.lalamove.com/pod.jpg" } });
    expect(within(dialog).getByRole("alert").textContent).toBe("Paste the image link as a web address starting with https://.");
    expect(confirmButton(dialog).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Delivery photo link"), { target: { value: "https://share.lalamove.com/pod.jpg" } });
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(confirmButton(dialog).disabled).toBe(false);
  });

  it("downloads the linked image, then delivers with it and records the link", async () => {
    vi.mocked(importDeliveryPhotoLink).mockResolvedValue({ ok: true, reference: "linked-image", filename: "delivery-proof.jpg", contentType: "image/jpeg", size: 10 });
    vi.mocked(deliverOrder).mockResolvedValue(moved(1042, "delivered"));
    const dialog = openDelivery();
    fireEvent.change(within(dialog).getByLabelText("Delivery photo link"), { target: { value: " https://share.lalamove.com/pod.jpg " } });
    fireEvent.click(confirmButton(dialog));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 delivered."));
    expect(importDeliveryPhotoLink).toHaveBeenCalledWith("https://share.lalamove.com/pod.jpg");
    const [, form] = vi.mocked(deliverOrder).mock.calls[0];
    expect(form?.getAll("photo")).toEqual(["linked-image"]);
    expect(form?.get("photoLink")).toBe("https://share.lalamove.com/pod.jpg");
  });

  it("rolls the card back with the reason when the link gives no image, without delivering", async () => {
    const reason = "That link didn't give us a JPG or PNG image. Save the image and upload it instead.";
    vi.mocked(importDeliveryPhotoLink).mockResolvedValue({ ok: false, reason });
    const dialog = openDelivery();
    fireEvent.change(within(dialog).getByLabelText("Delivery photo link"), { target: { value: "https://share.lalamove.com/page" } });
    fireEvent.click(confirmButton(dialog));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
    expect(deliverOrder).not.toHaveBeenCalled();
    tab("Out for delivery");
    await waitFor(() => expect(screen.getByRole("link", { name: "#1042" })).toBeTruthy());
  });
});

describe("the All active board", () => {
  const everyPhase = () =>
    board({
      ready: [card({ id: 1 })],
      preparing: [card({ id: 2, status: "preparing" })],
      dispatched: [card({ id: 3, status: "dispatched" }), card({ id: 5, status: "dispatched", failedOpen: true })],
      delivered: [card({ id: 4, status: "delivered", deliveredAt: new Date("2026-10-21T00:00:00Z") })],
    });

  it("has a column for each phase, each holding its own Orders", () => {
    everyPhase();
    expect(links(column("To pack"))).toEqual(["#1"]);
    expect(links(column("Preparing"))).toEqual(["#2"]);
    expect(links(column("Out for delivery"))).toEqual(expect.arrayContaining(["#3", "#5"]));
    expect(screen.queryByRole("region", { name: "Failed" })).toBeNull();
    expect(links(column("Completed"))).toEqual(["#4"]);
  });

  it("keeps the other tabs as one grid", () => {
    everyPhase();
    tab("Preparing");
    expect(screen.queryByRole("region", { name: "To pack" })).toBeNull();
    expect(screen.getByRole("link", { name: "#2" })).toBeTruthy();
  });

  it("gives each phase's button its own colour", () => {
    everyPhase();
    const classes = (id: number, name: string) => within(cardFor(id)).getByRole("button", { name }).className;
    expect(classes(1, "Pack order")).toContain("bg-primary");
    expect(classes(2, "Mark as dispatched")).toContain("bg-[#1d4ed8]");
    expect(classes(2, "Mark as dispatched")).not.toContain("bg-primary");
    expect(classes(3, "Mark as delivered")).toContain("bg-[#15803d]");
    expect(classes(3, "Mark as delivered")).not.toContain("bg-primary");
  });

  it.each([
    ["to-pack", "preparing", true],
    ["preparing", "out-for-delivery", true],
    ["out-for-delivery", "completed", true],
    ["failed", "completed", false],
    ["to-pack", "out-for-delivery", false],
    ["preparing", "to-pack", false],
    ["out-for-delivery", "failed", false],
    ["preparing", "preparing", false],
    ["completed", "out-for-delivery", false],
  ])("allows a drag from %s to %s: %s", (from, to, allowed) => {
    expect(allowsDrop(from, to)).toBe(allowed);
  });

  it("asks with the move's own dialog after a drop, and Cancel leaves the card where it was", () => {
    everyPhase();
    dropOn(1, "to-pack", "preparing");

    const dialog = screen.getByRole("alertdialog", { name: "Pack Order #1?" });
    expect(startPreparing).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(links(column("To pack"))).toEqual(["#1"]);
    expect(startPreparing).not.toHaveBeenCalled();
  });

  it("moves the dropped card at once on confirm, and puts it back with the reason on refusal", async () => {
    const pending = deferred<Awaited<ReturnType<typeof startPreparing>>>();
    vi.mocked(startPreparing).mockReturnValue(pending.promise);
    everyPhase();
    dropOn(1, "to-pack", "preparing");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Pack order" }));

    expect(links(column("Preparing"))).toEqual(["#1", "#2"]);
    await act(async () => pending.settle({ ok: false, reason: "Out of stock." }));
    expect(toast.error).toHaveBeenCalledWith("Out of stock.");
    await waitFor(() => expect(links(column("To pack"))).toEqual(["#1"]));
  });

  it.each([
    [2, "preparing", "to-pack"],
    [2, "preparing", null],
    [1, "to-pack", "completed"],
  ])("does nothing when Order %s is dropped from %s on %s", (id, from, to) => {
    everyPhase();
    dropOn(id, from, to);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("pages a long column 20 at a time, leaving the others alone", () => {
    board({
      ready: Array.from({ length: 21 }, (_, i) => card({ id: 100 + i })),
      preparing: [card({ id: 2, status: "preparing" })],
    });
    const ready = column("To pack");
    expect(links(ready)).toHaveLength(20);
    fireEvent.click(within(ready).getByRole("button", { name: "Next page" }));
    expect(links(ready)).toEqual(["#120"]);
    expect(links(column("Preparing"))).toEqual(["#2"]);
    expect(within(column("Preparing")).queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("pages the grid of another tab, and starts again at page 1 on a new tab", () => {
    board({ ready: Array.from({ length: 21 }, (_, i) => card({ id: 100 + i })) });
    tab("To pack");
    expect(screen.getByText("Showing 1–20 of 21 Orders")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 21–21 of 21 Orders")).toBeTruthy();
    tab("All");
    expect(screen.getByText("Showing 1–20 of 21 Orders")).toBeTruthy();
  });

  it.each([
    ["the board", () => everyPhase()],
    ["the loading skeleton", () => render(<Loading />)],
  ])("keeps What each move does folded away on %s, to be opened when wanted", (_where, show) => {
    show();
    const panel = screen.getByText("What each move does").closest("details") as HTMLDetailsElement;
    expect(panel.open).toBe(false);
    expect(within(panel).getByText("To pack → Preparing")).toBeTruthy();
  });

  it("shows the four columns while loading", () => {
    render(<Loading />);
    for (const name of ["To pack", "Preparing", "Out for delivery", "Completed"]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("region", { name: "Failed" })).toBeNull();
  });
});

const detail = (overrides: Partial<OrderDetail>): OrderDetail => ({
  paymentProofs: [],
  proofRejections: 0,
  deliveryPhotoFileId: null,
  deliveryPhotoRemovedAt: null,
  paidBy: null,
  codCollection: null,
  packedBy: null,
  id: 1042,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  status: "paid",
  fulfillmentMethod: "delivery",
  paymentMethod: "gcash",
  lines: [{ product: "Halaya", size: "500g", quantity: 2, price: 50_000 }],
  subtotal: 100_000,
  discount: 0,
  deliveryFee: 15_000,
  total: 115_000,
  address: null,
  feedback: null,
  paymentProof: null,
  paymentLabel: "Paid",
  customer: { id: "c1", name: "Maria Santos" },
  ...overrides,
});

const FULFILMENT = ["Fulfilment"];

describe("Order detail COD flags", () => {
  it("lists which rules fired, with no score, and shows nothing when none did", () => {
    const { unmount } = render(<OrderDetailView order={detail({ paymentMethod: "cash-on-delivery" })} modules={FULFILMENT} codFlags={[{ rule: "first-order", label: "First order", reason: "No earlier Orders" }, { rule: "earlier-failed-delivery", label: "Earlier failed delivery", reason: "Failed before" }]} />);
    const card = screen.getByTestId("cod-flags");
    expect(card.textContent).toContain("First order");
    expect(card.textContent).toContain("Earlier failed delivery");
    expect(card.textContent).not.toMatch(/%|score|risk/i);
    unmount();
    render(<OrderDetailView order={detail({ paymentMethod: "cash-on-delivery" })} modules={FULFILMENT} />);
    expect(screen.queryByTestId("cod-flags")).toBeNull();
  });
});

describe("Order detail packing", () => {
  it("shows the packer's name and offers the packing slip to Fulfilment", () => {
    render(<OrderDetailView order={detail({ status: "preparing", packedBy: { id: "u1", name: "Liza B.", at: new Date("2026-10-21T01:00:00Z") } })} modules={FULFILMENT} />);
    expect(screen.getByText(/Packed by Liza B\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print packing slip" })).toBeTruthy();
  });

  it("opens the slip PDF in a new tab, and says why when it cannot", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as never);
    URL.createObjectURL = vi.fn(() => "blob:slip");
    URL.revokeObjectURL = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(Response.json({ reason: "Order was not found." }, { status: 404 }));
    render(<OrderDetailView order={detail({ status: "paid" })} modules={FULFILMENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Print packing slip" }));
    expect(screen.getByRole("button", { name: "Preparing slip…" })).toBeTruthy();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order was not found."));
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");

    fetchMock.mockResolvedValueOnce(new Response(new Blob(["%PDF-"], { type: "application/pdf" })));
    fireEvent.click(screen.getByRole("button", { name: "Print packing slip" }));
    await waitFor(() => expect(tab.location.href).toBe("blob:slip"));
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringMatching(/\/api\/orders\/\d+\/packing-slip$/));
    open.mockRestore();
    fetchMock.mockRestore();
  });
});
const MOVES = ["Pack order", "Mark as dispatched", "Mark as delivered"];

describe("the Fulfilment Module's moves on an Order's detail", () => {
  it("hides Failed delivery and Cancel order the moment Mark as delivered is confirmed, and brings them back with the reason on a refusal", async () => {
    let answer!: (result: Awaited<ReturnType<typeof deliverOrder>>) => void;
    vi.mocked(deliverOrder).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<OrderDetailView order={detail({ status: "dispatched" })} modules={FULFILMENT} role="manager" />);
    expect(screen.getByRole("link", { name: "Failed delivery" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel order…" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark as delivered" }));
    choosePhoto(screen.getByRole("alertdialog"), png());
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark as delivered" }));

    await waitFor(() => expect(screen.queryByRole("link", { name: "Failed delivery" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Cancel order…" })).toBeNull();

    const reason = "Only a dispatched Order can be delivered; it may have already changed. Refresh it before trying again.";
    await act(async () => answer({ ok: false, reason }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
    expect(screen.getByRole("link", { name: "Failed delivery" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel order…" })).toBeTruthy();
  });

  it("offers the next move for each status", () => {
    const cases: [Partial<OrderDetail>, string[]][] = [
      [{ status: "paid" }, ["Pack order"]],
      [{ status: "confirmed", paymentMethod: "cash-on-delivery", paymentLabel: "Unpaid" }, ["Pack order"]],
      [{ status: "preparing" }, ["Mark as dispatched"]],
      [{ status: "dispatched" }, ["Mark as delivered"]],
    ];
    for (const [overrides, expected] of cases) {
      const { unmount } = render(<OrderDetailView order={detail(overrides)} modules={FULFILMENT} />);
      expect(screen.getAllByRole("button").map((b) => b.textContent).filter((t) => t !== "Print packing slip" && t !== "Orders")).toEqual(expected);
      unmount();
    }
  });

  it("offers no move before an Order is ready to prepare, or once it is delivered or cancelled", () => {
    for (const overrides of [
      { status: "placed" },
      { status: "confirmed" },
      { status: "awaiting payment" },
      { status: "delivered" },
      { status: "cancelled", paymentLabel: "Cancelled" as const },
    ]) {
      const { unmount } = render(<OrderDetailView order={detail(overrides)} modules={FULFILMENT} />);
      expect(screen.queryAllByRole("button").filter((b) => b.textContent !== "Print packing slip" && b.textContent !== "Orders")).toHaveLength(0);
      unmount();
    }
  });

  it("moves the Order through the same dialog", async () => {
    vi.mocked(dispatchOrder).mockResolvedValue(moved(1042, "dispatched"));
    render(<OrderDetailView order={detail({ status: "preparing" })} modules={FULFILMENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as dispatched" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Mark as dispatched" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: "Grab" }));
    fireEvent.change(within(dialog).getByLabelText("Booking share link (optional)"), { target: { value: "http://grab.test/1" } });
    expect(within(dialog).getByRole("alert").textContent).toContain("https://");
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Booking share link (optional)"), { target: { value: "https://grab.test/1" } });
    fireEvent.change(within(dialog).getByLabelText("Rider contact (optional)"), { target: { value: "0917 123 4567" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    // A Delivery dispatch emails the Customer, so it is never shown as done before the server confirms.
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 dispatched."));
    expect(dispatchOrder).toHaveBeenCalledWith(1042, { courier: "Grab", trackingUrl: "https://grab.test/1", riderName: "", riderPlate: "", riderPhone: "09171234567" });
  });

  it("says why when the server refuses a Delivery dispatch", async () => {
    vi.mocked(dispatchOrder).mockResolvedValue({ ok: false, reason: "Enter the booking's share link, starting with https://." });
    render(<OrderDetailView order={detail({ status: "preparing" })} modules={FULFILMENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as dispatched" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Lalamove" }));
    fireEvent.change(within(dialog).getByLabelText("Booking share link (optional)"), { target: { value: "https://x.test/1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as dispatched" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Enter the booking's share link, starting with https://."));
  });

  it("shows no moves to Staff without the Fulfilment Module", () => {
    for (const status of ["paid", "preparing", "dispatched"]) {
      for (const modules of [[], ["Orders"], ["Payments"], ["Orders", "Payments"]]) {
        const { unmount } = render(<OrderDetailView order={detail({ status })} modules={modules} />);
        for (const name of MOVES) expect(screen.queryByRole("button", { name })).toBeNull();
        unmount();
      }
    }
  });
});

describe("the Delivery photo on an Order's detail", () => {
  it("asks for the photo in the same dialog when delivering from the detail page", async () => {
    vi.mocked(deliverOrder).mockResolvedValue(moved(1042, "delivered"));
    render(<OrderDetailView order={detail({ status: "dispatched" })} modules={FULFILMENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as delivered" }));
    const dialog = screen.getByRole("alertdialog");

    expect((within(dialog).getByRole("button", { name: "Mark as delivered" }) as HTMLButtonElement).disabled).toBe(true);
    choosePhoto(dialog, png());
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as delivered" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 delivered."));
  });

  it("shows the photo on a delivered Order", () => {
    render(
      <OrderDetailView
        order={detail({ status: "delivered", deliveryPhotoFileId: "file-1" })}
        deliveryPhotoUrl="https://files.test/signed"
      />,
    );

    expect((screen.getByAltText("Delivery photo for Order #1042") as HTMLImageElement).src).toBe("https://files.test/signed");
    expect(screen.queryByText("No photo")).toBeNull();
  });

  it("says No photo on a legacy delivered Order", () => {
    render(<OrderDetailView order={detail({ status: "delivered", deliveryPhotoFileId: null })} />);

    expect(screen.getByRole("heading", { name: "Delivery photo" })).toBeTruthy();
    expect(screen.getByText("No photo")).toBeTruthy();
  });

  it("says the photo was removed, not No photo, once the retention job has removed it", () => {
    render(
      <OrderDetailView
        order={detail({ status: "received", deliveryPhotoFileId: null, deliveryPhotoRemovedAt: new Date("2026-10-30T00:00:00Z") })}
      />,
    );

    expect(screen.getByText("The Delivery photo was removed.")).toBeTruthy();
    expect(screen.queryByText("No photo")).toBeNull();
  });

  it("says the photo cannot be shown, not No photo, when it exists but cannot be reached", () => {
    render(<OrderDetailView order={detail({ status: "delivered", deliveryPhotoFileId: "file-1" })} deliveryPhotoUrl={null} />);

    expect(screen.queryByText("No photo")).toBeNull();
    expect(screen.getByText("The Delivery photo could not be loaded. Reload to try again.")).toBeTruthy();
  });

  it("shows nothing for an Order not yet delivered", () => {
    render(<OrderDetailView order={detail({ status: "dispatched" })} />);

    expect(screen.queryByRole("heading", { name: "Delivery photo" })).toBeNull();
  });

  it("also shows it once the Customer has marked the Order received", () => {
    render(<OrderDetailView order={detail({ status: "received" })} />);

    expect(screen.getByText("No photo")).toBeTruthy();
  });
});

describe("Order detail for a Deleted Customer", () => {
  it("tags the Customer without a profile link, and Staff can still move the Order forward", () => {
    render(<OrderDetailView order={detail({ status: "paid", customer: { id: "c1", name: "Deleted customer", deleted: true } })} modules={FULFILMENT} />);
    expect(screen.getByTestId("deleted-customer-tag").textContent).toBe("Deleted customer");
    expect(screen.queryByRole("link", { name: "Deleted customer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pack order" })).toBeTruthy();
  });
});
