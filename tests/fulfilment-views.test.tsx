// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverOrder, dispatchOrder, loadPackingSlip, markPickedUp, markReadyForPickup, startPreparing } from "@/features/orders/actions";
import { FulfilmentBoardView } from "@/features/orders/fulfilment-board";
import type { FulfilmentBoard, FulfilmentOrder } from "@/features/orders/fulfilment";
import { OrderDetailView } from "@/features/orders/order-detail";
import type { OrderDetail } from "@/features/orders/orders";

const refresh = vi.fn();
vi.mock("@/features/files/client", () => ({ uploadFile: vi.fn(async () => ({ ok: true, reference: "confirmed-image" })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({
  quoteDeliveryFee: vi.fn(),
  confirmPickup: vi.fn(),
  cancelOrder: vi.fn(),
  startPreparing: vi.fn(),
  loadPackingSlip: vi.fn(),
  dispatchOrder: vi.fn(),
  deliverOrder: vi.fn(),
  markReadyForPickup: vi.fn(),
  markPickedUp: vi.fn(),
}));
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

describe("the Fulfilment board", () => {
  it("has the eight tabs with their counts, named in screen wording", () => {
    board({
      ready: [card({ id: 1 }), card({ id: 2, status: "confirmed", paymentMethod: "cash-on-delivery", paymentLabel: "Unpaid" })],
      preparing: [card({ id: 3, status: "preparing" })],
    });

    const names = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names).toEqual(["All active3", "To pack2", "Preparing1", "Ready for pickup0", "Out for delivery0", "Failed0", "Completed0", "All3"]);
    for (const old of ["Waiting for rider", "Packed", "Shipped"]) {
      expect(screen.queryByRole("tab", { name: new RegExp(`^${old}`) })).toBeNull();
    }
  });

  it("filters the same Orders by tab: Failed apart from Out for delivery, Completed apart from the rest", () => {
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
    expect(screen.queryByRole("link", { name: "#5" })).toBeNull();
    tab("Failed");
    expect(screen.getByRole("link", { name: "#5" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Failed delivery/ }).getAttribute("href")).toBe("/orders/5/failed-delivery");
    tab("Completed");
    expect(screen.getByRole("link", { name: "#4" })).toBeTruthy();
    tab("All active");
    expect(screen.queryByRole("link", { name: "#4" })).toBeNull();
    tab("All");
    expect(screen.getByRole("link", { name: "#4" })).toBeTruthy();
  });

  it("uses the screen wording Out for delivery, Ready for pickup and Picked up", () => {
    board({
      dispatched: [card({ id: 3, status: "dispatched" })],
      ready: [card({ id: 6, status: "ready for pickup", fulfillmentMethod: "pickup" })],
    });
    expect(within(cardFor(3)).getByText("Out for delivery")).toBeTruthy();
    expect(within(cardFor(6)).getByText("Ready for pickup")).toBeTruthy();
    expect(screen.queryByText("Dispatched")).toBeNull();
    tab("Ready for pickup");
    expect(screen.getByRole("link", { name: "#6" })).toBeTruthy();
  });

  it("shows a collected Pickup Order as Picked up on Completed", () => {
    board({ delivered: [card({ id: 7, status: "collected", fulfillmentMethod: "pickup", deliveredAt: new Date("2026-10-21T03:00:00Z") })] });
    tab("Completed");
    expect(within(cardFor(7)).getByText("Picked up 21 Oct 2026")).toBeTruthy();
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

  it("asks for no courier on a Pickup move or a delivery, but a Delivery dispatch asks for the booking", () => {
    board({
      preparing: [card({ id: 1, status: "preparing", fulfillmentMethod: "pickup" }), card({ id: 3, status: "preparing" })],
      dispatched: [card({ id: 2, status: "dispatched" })],
    });
    for (const id of [1, 2]) {
      fireEvent.click(within(cardFor(id)).getByRole("button", { name: id === 1 ? "Mark ready for pickup" : "Mark as delivered" }));
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

  it("moves a Pickup Order to Ready for pickup at once, and confirms only when the server does", async () => {
    const pending = deferred<Awaited<ReturnType<typeof markReadyForPickup>>>();
    vi.mocked(markReadyForPickup).mockReturnValue(pending.promise);
    board({ preparing: [card({ status: "preparing", fulfillmentMethod: "pickup" })] });
    expect(within(cardFor(1042)).queryByRole("button", { name: "Mark as dispatched" })).toBeNull();
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark ready for pickup" }));

    const dialog = screen.getByRole("alertdialog", { name: "Mark Order #1042 ready for pickup?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark ready for pickup" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(cardFor(1042)).getByRole("button", { name: "Mark as picked up" })).toBeTruthy();
    expect(markReadyForPickup).toHaveBeenCalledWith(1042);
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => pending.settle(moved(1042, "ready for pickup")));

    expect(toast.success).toHaveBeenCalledWith("Order #1042 is ready for pickup.");
    expect(refresh).toHaveBeenCalled();
  });

  it("marks a Ready for pickup Order as picked up after a confirm dialog", async () => {
    vi.mocked(markPickedUp).mockResolvedValue(moved(1042, "collected"));
    board({ preparing: [card({ status: "ready for pickup", fulfillmentMethod: "pickup" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as picked up" }));
    const dialog = screen.getByRole("alertdialog", { name: "Mark Order #1042 as picked up?" });
    expect(markPickedUp).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as picked up" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 picked up."));
    expect(markPickedUp).toHaveBeenCalledWith(1042, undefined);
  });

  it("records the collected cash with a COD pickup: pre-filled with the total, shows the move, updates at once, and rolls back with the reason on refusal", async () => {
    const pending = deferred<Awaited<ReturnType<typeof markPickedUp>>>();
    vi.mocked(markPickedUp).mockReturnValue(pending.promise);
    board({ preparing: [card({ status: "ready for pickup", fulfillmentMethod: "pickup", paymentMethod: "cash-on-delivery", total: 115_050 })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as picked up" }));
    const dialog = screen.getByRole("alertdialog", { name: "Mark Order #1042 as picked up?" });
    const amount = within(dialog).getByLabelText("Payment collected (₱)") as HTMLInputElement;
    expect(amount.value).toBe("1150.50");
    expect(within(dialog).getByText("Ready for pickup → Picked up")).toBeTruthy();
    expect(within(dialog).getByText(/Payment collected with your name/)).toBeTruthy();
    expect(within(dialog).queryByText(/remit/i)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as picked up" }));

    // Optimistic and instant: the dialog closes and the card moves at once; a refusal rolls it back with the reason.
    expect(markPickedUp).toHaveBeenCalledWith(1042, 115_050);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as picked up" })).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () => pending.settle({ ok: false, reason: "The collected amount must equal the Order total of ₱1150.50." }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The collected amount must equal the Order total of ₱1150.50."));
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(cardFor(1042)).getByRole("button", { name: "Mark as picked up" })).toBeTruthy();
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

  it("asks for no amount on an Order that is not Cash on Delivery", () => {
    board({ preparing: [card({ status: "ready for pickup", fulfillmentMethod: "pickup" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as picked up" }));
    expect(screen.queryByLabelText("Payment collected (₱)")).toBeNull();
  });

  it("offers Picked up, not Delivered, for a legacy Pickup Order that is already dispatched", () => {
    board({ preparing: [card({ status: "dispatched", fulfillmentMethod: "pickup" })] });
    expect(within(cardFor(1042)).getByRole("button", { name: "Mark as picked up" })).toBeTruthy();
    expect(within(cardFor(1042)).queryByRole("button", { name: "Mark as delivered" })).toBeNull();
  });

  it("says why when the server refuses a pickup move, and rolls the Order back", async () => {
    vi.mocked(markReadyForPickup).mockResolvedValue({ ok: false, reason: "Order already changed; refresh it before trying again." });
    board({ preparing: [card({ status: "preparing", fulfillmentMethod: "pickup" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark ready for pickup" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark ready for pickup" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order already changed; refresh it before trying again."));
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(within(cardFor(1042)).getByRole("button", { name: "Mark ready for pickup" })).toBeTruthy());
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

  it("loads the slip and prints it, and says why when it cannot", async () => {
    const print = vi.fn();
    window.print = print;
    vi.mocked(loadPackingSlip).mockResolvedValueOnce({ ok: false, reason: "Order was not found." });
    render(<OrderDetailView order={detail({ status: "paid" })} modules={FULFILMENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Print packing slip" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order was not found."));
    expect(print).not.toHaveBeenCalled();

    vi.mocked(loadPackingSlip).mockResolvedValueOnce({ ok: true, slip: {
      id: 1042, createdAt: new Date("2026-10-20T00:00:00Z"), customer: { id: "c1", name: "Maria Santos" },
      fulfillmentMethod: "delivery", lines: [{ product: "Halaya", size: "500g", quantity: 2, price: 50_000 }], address: null, packedBy: null,
    } } as never);
    fireEvent.click(screen.getByRole("button", { name: "Print packing slip" }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(screen.getByLabelText("Packing slip").textContent).toContain("Halaya");
  });
});
const MOVES = ["Pack order", "Mark as dispatched", "Mark as delivered", "Mark ready for pickup", "Mark as picked up"];

describe("the Fulfilment Module's moves on an Order's detail", () => {
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
