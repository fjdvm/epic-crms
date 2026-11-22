// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { refresh, publish, setPrice, upload, toastError, toastSuccess, toastInfo } = vi.hoisted(() => ({
  refresh: vi.fn(), publish: vi.fn(), setPrice: vi.fn(), upload: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn(), toastInfo: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess, info: toastInfo } }));
vi.mock("@/features/orders/product-content-actions", () => ({ publishProductContent: publish, setProductPrice: setPrice }));
vi.mock("@/features/files/client", () => ({ uploadFile: upload }));

import { ProductEditDrawer } from "@/features/orders/product-edit-drawer";
import type { StockRow } from "@/features/orders/stock";
import { StockView } from "@/features/orders/stock-view";

const row: StockRow = {
  sizeId: 12, product: "Ube Jam Extreme", imsName: "Ube Jam Extreme", size: "250g Container", image: null, price: 250, description: "Sweet ube.", marker: null,
  inStock: 40, reserved: 4, available: 36, shows: "In stock", orders: [],
};

beforeEach(() => {
  publish.mockResolvedValue({ ok: true });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => {} }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const open = () => render(<ProductEditDrawer row={row} onClose={vi.fn()} />);

it("shows the shop name as editable, the IMS name for reference, and the stock figures as disabled fields", () => {
  open();
  const name = screen.getByLabelText("Shop name") as HTMLInputElement;
  // Empty means the IMS name, which shows as the placeholder and the hint.
  expect(name.value).toBe("");
  expect(name.placeholder).toBe("Ube Jam Extreme");
  expect(name.disabled).toBe(false);
  expect(screen.getByText(/IMS name: Ube Jam Extreme · 250g Container/)).toBeTruthy();
  for (const [label, value] of [["In stock", "40"], ["Reserved", "4"], ["Available online", "36"]]) {
    const field = screen.getByLabelText(label) as HTMLInputElement;
    expect(field.value).toBe(value);
    expect(field.disabled).toBe(true);
  }
});

it("starts with the published description and lets Staff change it", () => {
  open();
  const description = screen.getByLabelText("Description") as HTMLTextAreaElement;
  expect(description.value).toBe("Sweet ube.");
  expect(description.disabled).toBe(false);
});

it("Cancel closes without saving anything", () => {
  const onClose = vi.fn();
  render(<ProductEditDrawer row={row} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("asks to confirm before publishing, then sends the description and says it is published", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Fresh ube jam." } });
  fireEvent.click(screen.getByRole("button", { name: "Publish to store" }));
  expect(publish).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await waitFor(() => expect(publish).toHaveBeenCalledWith(12, "Fresh ube jam.", null, ""));
  await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  expect(refresh).toHaveBeenCalled();
});

it("uploads a chosen image, previews it, and publishes its reference", async () => {
  upload.mockResolvedValue({ ok: true, reference: "ref-1" });
  open();
  const file = new File(["x"], "jam.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Product image"), { target: { files: [file] } });
  await waitFor(() => expect(upload).toHaveBeenCalledWith("Orders", file));
  expect((await screen.findByAltText("New image preview") as HTMLImageElement).src).toBe("blob:preview");
  fireEvent.click(screen.getByRole("button", { name: "Publish to store" }));
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await waitFor(() => expect(publish).toHaveBeenCalledWith(12, "Sweet ube.", "ref-1", ""));
});

it("says why an image was refused and keeps Publish possible without it", async () => {
  upload.mockResolvedValue({ ok: false, reason: "Choose a JPG or PNG image." });
  open();
  fireEvent.change(screen.getByLabelText("Product image"), { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
  expect(await screen.findByText("Choose a JPG or PNG image.")).toBeTruthy();
  expect(screen.queryByAltText("New image preview")).toBeNull();
});

it("tells Staff why a refused publish did not go through", async () => {
  publish.mockResolvedValue({ ok: false, reason: "Your Role can only view shop work." });
  open();
  fireEvent.click(screen.getByRole("button", { name: "Publish to store" }));
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await waitFor(() => expect(toastError).toHaveBeenCalledWith("Your Role can only view shop work."));
});

const page = { hasStock: true, summary: { sizes: 1, soldOut: 0, reserved: 4, low: 0 }, rows: [row] };

it("opens from the row's edit button for Staff, and shows no edit button to a read-only Role", () => {
  const { unmount } = render(<StockView page={page} canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Ube Jam Extreme · 250g Container" }));
  expect(screen.getByLabelText("Description")).toBeTruthy();
  unmount();
  render(<StockView page={page} canEdit={false} />);
  expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
});

it("publishes CREOMS's own shop name, and starts from it when one is set", async () => {
  render(<ProductEditDrawer row={{ ...row, product: "Ube Jam Deluxe" }} onClose={vi.fn()} />);
  const name = screen.getByLabelText("Shop name") as HTMLInputElement;
  expect(name.value).toBe("Ube Jam Deluxe");
  fireEvent.change(name, { target: { value: "Ube Jam Supreme" } });
  fireEvent.click(screen.getByRole("button", { name: "Publish to store" }));
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await waitFor(() => expect(publish).toHaveBeenCalledWith(12, "Sweet ube.", null, "Ube Jam Supreme"));
});

it("lets a Manager set the shop price on its own confirm, waiting for the server", async () => {
  let answer: (value: { ok: true }) => void = () => {};
  setPrice.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  render(<ProductEditDrawer row={row} canPrice onClose={vi.fn()} />);
  const price = screen.getByLabelText("Shop price in pesos") as HTMLInputElement;
  expect(price.value).toBe("250.00");
  // Unchanged: nothing to set.
  expect((screen.getByRole("button", { name: "Set price" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(price, { target: { value: "275abc" } });
  expect(price.value).toBe("275");
  fireEvent.click(screen.getByRole("button", { name: "Set price" }));
  expect(setPrice).not.toHaveBeenCalled();
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getAllByRole("button", { name: "Set price" }).at(-1)!);
  await waitFor(() => expect(setPrice).toHaveBeenCalledWith(12, "275"));
  // Money is never optimistic: the dialog spins until the server answers.
  expect(await screen.findByText("Saving…")).toBeTruthy();
  expect(toastSuccess).not.toHaveBeenCalled();
  answer({ ok: true });
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Shop price set."));
});

it("shows Staff the price read-only with Request approval, which needs a suggested price and a reason", async () => {
  setPrice.mockResolvedValue({ ok: false, reason: "Waiting for approval", approvalId: "a1" });
  render(<ProductEditDrawer row={row} onClose={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Set price" })).toBeNull();
  expect((screen.getByLabelText("Shop price") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Request approval…" }));
  const send = await screen.findByRole("button", { name: "Send request" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Shop price in pesos"), { target: { value: "300" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Supplier cost went up." } });
  expect(send.disabled).toBe(false);
  fireEvent.click(send);
  await waitFor(() => expect(setPrice).toHaveBeenCalledWith(12, "300", "Supplier cost went up."));
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Sent to a Manager. The price changes once they approve."));
});

it("says why a price was refused and keeps the price on screen", async () => {
  setPrice.mockResolvedValue({ ok: false, reason: "Your Role can only view shop work." });
  render(<ProductEditDrawer row={row} canPrice onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Shop price in pesos"), { target: { value: "260" } });
  fireEvent.click(screen.getByRole("button", { name: "Set price" }));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getAllByRole("button", { name: "Set price" }).at(-1)!);
  await waitFor(() => expect(toastError).toHaveBeenCalledWith("Your Role can only view shop work."));
});
