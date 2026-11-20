// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { refresh, publish, upload, toastError, toastSuccess } = vi.hoisted(() => ({
  refresh: vi.fn(), publish: vi.fn(), upload: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess, info: vi.fn() } }));
vi.mock("@/features/orders/product-content-actions", () => ({ publishProductContent: publish }));
vi.mock("@/features/files/client", () => ({ uploadFile: upload }));

import { ProductEditDrawer } from "@/features/orders/product-edit-drawer";
import type { StockRow } from "@/features/orders/stock";
import { StockView } from "@/features/orders/stock-view";

const row: StockRow = {
  sizeId: 12, product: "Ube Jam Extreme", size: "250g Container", image: null, description: "Sweet ube.", marker: null,
  inStock: 40, reserved: 4, available: 36, shows: "In stock", orders: [],
};

beforeEach(() => {
  publish.mockResolvedValue({ ok: true });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => {} }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const open = () => render(<ProductEditDrawer row={row} onClose={vi.fn()} />);

it("shows the product title and the stock figures as disabled fields", () => {
  open();
  const title = screen.getByLabelText("Product") as HTMLInputElement;
  expect(title.value).toBe("Ube Jam Extreme · 250g Container");
  expect(title.disabled).toBe(true);
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
  await waitFor(() => expect(publish).toHaveBeenCalledWith(12, "Fresh ube jam.", null));
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
  await waitFor(() => expect(publish).toHaveBeenCalledWith(12, "Sweet ube.", "ref-1"));
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

const page = { imsReachable: true, summary: { sizes: 1, soldOut: 0, reserved: 4, low: 0 }, rows: [row] };

it("opens from the row's edit button for Staff, and shows no edit button to a read-only Role", () => {
  const { unmount } = render(<StockView page={page} canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Ube Jam Extreme · 250g Container" }));
  expect(screen.getByLabelText("Description")).toBeTruthy();
  unmount();
  render(<StockView page={page} canEdit={false} />);
  expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
});
