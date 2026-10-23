// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverOrder, dispatchOrder, startPreparing } from "@/features/orders/actions";
import { FulfilmentBoardView } from "@/features/orders/fulfilment-board";
import type { FulfilmentBoard, FulfilmentOrder } from "@/features/orders/fulfilment";
import { OrderDetailView } from "@/features/orders/order-detail";
import type { OrderDetail } from "@/features/orders/orders";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({
  quoteDeliveryFee: vi.fn(),
  confirmPickup: vi.fn(),
  cancelOrder: vi.fn(),
  startPreparing: vi.fn(),
  dispatchOrder: vi.fn(),
  deliverOrder: vi.fn(),
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
  ...overrides,
});

const EMPTY: FulfilmentBoard = { ready: [], preparing: [], dispatched: [], delivered: [] };

function board(columns: Partial<FulfilmentBoard>) {
  return render(<FulfilmentBoardView board={{ ...EMPTY, ...columns }} />);
}

const png = (name = "delivered.png") => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
const choosePhoto = (dialog: HTMLElement, file: File) =>
  fireEvent.change(within(dialog).getByLabelText("Delivery photo"), { target: { files: [file] } });

const column = (name: string) => screen.getByRole("region", { name });
const cardFor = (id: number) => screen.getByRole("link", { name: `#${id}` }).closest("[data-fulfilment-card]") as HTMLElement;

describe("the Fulfilment board", () => {
  it("has a column per status with its count, named after the storefront's statuses", () => {
    board({
      ready: [card({ id: 1 }), card({ id: 2, status: "confirmed", paymentMethod: "cash-on-delivery", paymentLabel: "Unpaid" })],
      preparing: [card({ id: 3, status: "preparing" })],
    });

    expect(within(column("Ready to prepare")).getByText("2")).toBeTruthy();
    expect(within(column("Preparing")).getByText("1")).toBeTruthy();
    expect(within(column("Dispatched")).getByText("0")).toBeTruthy();
    expect(within(column("Delivered (7 days)")).getByText("0")).toBeTruthy();
    for (const design of ["To pack", "Packed", "Shipped"]) {
      expect(screen.queryByText(design)).toBeNull();
    }
  });

  it("puts each card in the column the board gives it", () => {
    board({
      ready: [card({ id: 1 })],
      preparing: [card({ id: 2, status: "preparing" })],
      dispatched: [card({ id: 3, status: "dispatched" })],
      delivered: [card({ id: 4, status: "delivered", deliveredAt: new Date("2026-10-21T00:00:00Z") })],
    });

    expect(within(column("Ready to prepare")).getByRole("link", { name: "#1" })).toBeTruthy();
    expect(within(column("Preparing")).getByRole("link", { name: "#2" })).toBeTruthy();
    expect(within(column("Dispatched")).getByRole("link", { name: "#3" })).toBeTruthy();
    expect(within(column("Delivered (7 days)")).getByRole("link", { name: "#4" })).toBeTruthy();
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

    expect(within(cardFor(1042)).getByText("Delivered 21 Oct 2026")).toBeTruthy();
  });

  it("offers each card only its next move, and none once delivered", () => {
    board({
      ready: [card({ id: 1 })],
      preparing: [card({ id: 2, status: "preparing" })],
      dispatched: [card({ id: 3, status: "dispatched" })],
      delivered: [card({ id: 4, status: "delivered", deliveredAt: new Date("2026-10-21T00:00:00Z") })],
    });

    const buttons = (id: number) => within(cardFor(id)).queryAllByRole("button").map((b) => b.textContent);
    expect(buttons(1)).toEqual(["Start preparing"]);
    expect(buttons(2)).toEqual(["Mark as dispatched"]);
    expect(buttons(3)).toEqual(["Mark as delivered"]);
    expect(buttons(4)).toEqual([]);
  });

  it("says so when a column is empty", () => {
    board({});

    expect(within(column("Preparing")).getByText("No Orders here.")).toBeTruthy();
  });

  it("has no courier, tracking or packing-slip fields or buttons, on the board or in any move", () => {
    board({ preparing: [card({ id: 1, status: "preparing" })], dispatched: [card({ id: 2, status: "dispatched" })] });
    const fields = /courier|tracking|packing slip|received by|proof of delivery|delivered on/i;

    expect(screen.queryAllByRole("button", { name: fields })).toHaveLength(0);
    for (const [id, move] of [[1, "Mark as dispatched"], [2, "Mark as delivered"]] as const) {
      fireEvent.click(within(cardFor(id)).getByRole("button", { name: move }));
      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).queryAllByRole("textbox")).toHaveLength(0);
      expect(within(dialog).queryAllByRole("switch")).toHaveLength(0);
      expect(within(dialog).queryAllByLabelText(fields)).toHaveLength(0);
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    }
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
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Start preparing" }));

    const dialog = screen.getByRole("alertdialog", { name: "Start preparing Order #1042?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(startPreparing).not.toHaveBeenCalled();
  });

  it("closes the dialog at once, and tells Staff only once the server confirms", async () => {
    const pending = deferred<Awaited<ReturnType<typeof dispatchOrder>>>();
    vi.mocked(dispatchOrder).mockReturnValue(pending.promise);
    board({ preparing: [card({ status: "preparing" })] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Mark as dispatched" }));

    const dialog = screen.getByRole("alertdialog", { name: "Mark Order #1042 as dispatched?" });
    expect(within(dialog).getByText(/no courier or tracking number/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as dispatched" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(cardFor(1042)).getByRole("button", { name: "Mark as delivered" })).toBeTruthy();
    expect(dispatchOrder).toHaveBeenCalledWith(1042);
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => pending.settle(moved(1042, "dispatched")));

    expect(toast.success).toHaveBeenCalledWith("Order #1042 dispatched.");
    expect(refresh).toHaveBeenCalled();
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
    expect(form?.getAll("photo")).toEqual([photo]);
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

  it("starts preparing once the server confirms", async () => {
    vi.mocked(startPreparing).mockResolvedValue(moved(1042, "preparing"));
    board({ ready: [card({})] });
    fireEvent.click(within(cardFor(1042)).getByRole("button", { name: "Start preparing" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start preparing" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 is now preparing."));
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
    expect(within(column("Dispatched")).getByRole("link", { name: "#1042" })).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
});

const detail = (overrides: Partial<OrderDetail>): OrderDetail => ({
  deliveryPhotoFileId: null,
  paidBy: null,
  id: 1042,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  status: "paid",
  fulfillmentMethod: "delivery",
  paymentMethod: "gcash",
  lines: [{ product: "Halaya", size: "500g", quantity: 2, price: 50_000 }],
  subtotal: 100_000,
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
const MOVES = ["Start preparing", "Mark as dispatched", "Mark as delivered"];

describe("the Fulfilment Module's moves on an Order's detail", () => {
  it("offers the next move for each status", () => {
    const cases: [Partial<OrderDetail>, string[]][] = [
      [{ status: "paid" }, ["Start preparing"]],
      [{ status: "confirmed", paymentMethod: "cash-on-delivery", paymentLabel: "Unpaid" }, ["Start preparing"]],
      [{ status: "preparing" }, ["Mark as dispatched"]],
      [{ status: "dispatched" }, ["Mark as delivered"]],
    ];
    for (const [overrides, expected] of cases) {
      const { unmount } = render(<OrderDetailView order={detail(overrides)} modules={FULFILMENT} />);
      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(expected);
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
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      unmount();
    }
  });

  it("moves the Order through the same dialog", async () => {
    vi.mocked(dispatchOrder).mockResolvedValue(moved(1042, "dispatched"));
    render(<OrderDetailView order={detail({ status: "preparing" })} modules={FULFILMENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as dispatched" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark as dispatched" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 dispatched."));
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
