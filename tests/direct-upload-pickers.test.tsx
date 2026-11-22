// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestFileUpload, confirmFileUpload } from "@/features/files/actions";
import { FulfilmentMove } from "@/features/orders/fulfilment-moves";
import { deliverOrder } from "@/features/orders/actions";
import { ReturnActions } from "@/features/returns/return-actions";
import { saveRefundProof } from "@/features/returns/refund-proof-actions";

vi.mock("@/features/files/actions", () => ({ requestFileUpload: vi.fn(), confirmFileUpload: vi.fn() }));
vi.mock("@/features/orders/actions", () => ({ deliverOrder: vi.fn(), dispatchOrder: vi.fn(), startPreparing: vi.fn() }));
vi.mock("@/features/returns/actions", () => ({
  approveReturn: vi.fn(), declineReturn: vi.fn(), markReturnGoodsReceived: vi.fn(), markReturnRefunded: vi.fn(), markReturnReplaced: vi.fn(),
}));
const { toast, refresh, push } = vi.hoisted(() => ({ toast: { error: vi.fn(), success: vi.fn() }, refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/features/returns/refund-proof-actions", () => ({ saveRefundProof: vi.fn(), correctRefundReading: vi.fn(), proceedDespiteRefundFlag: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const put = vi.fn<typeof fetch>();
const photo = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "door.png", { type: "image/png" });
const storageUrl = "https://storage.test/signed-upload";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", put);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:preview");
    static revokeObjectURL = vi.fn();
  });
  put.mockResolvedValue(new Response(null, { status: 200 }));
  vi.mocked(requestFileUpload).mockResolvedValue({ ok: true, reference: "pending-reference", uploadUrl: storageUrl });
  vi.mocked(confirmFileUpload).mockResolvedValue({ ok: true, reference: "ready-reference", filename: "door.png", contentType: "image/png", size: 4 });
  vi.mocked(deliverOrder).mockResolvedValue({ ok: true, order: { id: 1042, status: "delivered", deliveryFeeInCentavos: null } });
  vi.mocked(saveRefundProof).mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const evidence = [
  {
    module: "Fulfilment", label: "Delivery photo", trigger: "Mark as delivered", confirmLabel: "Mark as delivered", field: "photo", id: 1042,
    render: () => render(<FulfilmentMove order={{ id: 1042, status: "dispatched", paymentMethod: "gcash", total: 10000 }} />),
    submit: deliverOrder,
  },
  {
    module: "Returns", label: "Refund proof", trigger: "Save refund proof", confirmLabel: "Save proof", field: "proof", id: 15,
    render: () => render(<ReturnActions id={15} number="RMA-15" status="goods received" goodsRequired preferredResolution="refund" finalResolution="refund" />),
    submit: saveRefundProof,
  },
] as const;

function pick(label: string, file: File) {
  if (label === "Refund proof") {
    // A refund also records what was sent (#613).
    const dialog = within(screen.getByRole("alertdialog"));
    fireEvent.change(dialog.getByLabelText(/Amount sent/), { target: { value: "100.00" } });
    fireEvent.change(dialog.getByLabelText(/Sent by/), { target: { value: "gcash" } });
    fireEvent.change(dialog.getByLabelText(/Reference/), { target: { value: "GC-2026-0001" } });
  }
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

for (const picker of evidence) {
  describe(`${picker.label} direct upload`, () => {
    function open() {
      picker.render();
      fireEvent.click(screen.getByRole("button", { name: picker.trigger }));
      return screen.getByRole("alertdialog");
    }
    function confirm(dialog: HTMLElement) {
      fireEvent.click(within(dialog).getByRole("button", { name: picker.confirmLabel }));
    }

    it("previews locally, waits for confirmation, sends bytes to storage and submits only the confirmed reference", async () => {
      const uploaded = deferred<Response>();
      const confirmed = deferred<Awaited<ReturnType<typeof confirmFileUpload>>>();
      put.mockReturnValue(uploaded.promise);
      vi.mocked(confirmFileUpload).mockReturnValue(confirmed.promise);
      const dialog = open();
      const file = photo();
      pick(picker.label, file);
      expect(within(dialog).getByAltText("Preview of door.png").getAttribute("src")).toBe("blob:preview");
      expect(requestFileUpload).not.toHaveBeenCalled();
      expect(picker.submit).not.toHaveBeenCalled();
      confirm(dialog);

      await waitFor(() => expect(put).toHaveBeenCalledWith(storageUrl, {
        method: "PUT", headers: { "Content-Type": "image/png" }, body: file, credentials: "omit", redirect: "error",
      }));
      expect(requestFileUpload).toHaveBeenCalledWith(picker.module, { filename: "door.png", contentType: "image/png", size: 4 }, { ticketId: null });
      expect(confirmFileUpload).not.toHaveBeenCalled();
      expect(picker.submit).not.toHaveBeenCalled();
      expect(within(dialog).getByRole("button", { name: /Saving…|Marking delivered…/ }).getAttribute("disabled")).not.toBeNull();

      await act(async () => uploaded.resolve(new Response(null, { status: 200 })));
      expect(confirmFileUpload).toHaveBeenCalledWith(picker.module, "pending-reference");
      expect(picker.submit).not.toHaveBeenCalled();
      await act(async () => confirmed.resolve({ ok: true, reference: "ready-reference", filename: "door.png", contentType: "image/png", size: 4 }));
      await waitFor(() => expect(picker.submit).toHaveBeenCalledTimes(1));
      expect(confirmFileUpload).toHaveBeenCalledWith(picker.module, "pending-reference");
      const [id, form] = vi.mocked(picker.submit).mock.calls[0];
      expect(id).toBe(picker.id);
      // The File travels only as its confirmed reference; a refund also carries the details Staff recorded.
      expect((form as FormData).getAll(picker.field)).toEqual(["ready-reference"]);
      expect(Array.from((form as FormData).keys())).toEqual(picker.module === "Returns" ? [picker.field, "sentAmount", "sentVia", "sentOn", "sentReference"] : [picker.field]);
    });

    it("cancels without uploading or submitting", () => {
      const dialog = open();
      pick(picker.label, photo());
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(requestFileUpload).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(picker.submit).not.toHaveBeenCalled();
    });

    it.each([
      ["empty", () => new File([], "empty.png", { type: "image/png" }), "That image is empty. Choose a JPG or PNG with something in it."],
      ["too large", () => new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }), "That image is over 5 MB. Choose a smaller JPG or PNG."],
      ["wrong type", () => new File(["pdf"], "proof.pdf", { type: "application/pdf" }), "Only JPG or PNG images can be attached."],
    ] as const)("refuses a %s file before any upload", (_name, file, reason) => {
      const dialog = open();
      pick(picker.label, file());
      expect(within(dialog).getByRole("alert").textContent).toBe(reason);
      confirm(dialog);
      expect(requestFileUpload).not.toHaveBeenCalled();
      expect(picker.submit).not.toHaveBeenCalled();
    });

    it.each(["request", "PUT", "confirmation"] as const)("shows a refusal at %s without submitting the record", async (stage) => {
      const reason = "The uploaded file does not match its declared size or type.";
      if (stage === "request") vi.mocked(requestFileUpload).mockResolvedValue({ ok: false, reason });
      if (stage === "PUT") put.mockRejectedValue(new Error("offline"));
      if (stage === "confirmation") vi.mocked(confirmFileUpload).mockResolvedValue({ ok: false, reason });
      const dialog = open();
      pick(picker.label, photo());
      confirm(dialog);
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(stage === "PUT" ? "The file could not be uploaded. Please try again." : reason));
      expect(picker.submit).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      if (stage !== "confirmation") expect(confirmFileUpload).not.toHaveBeenCalled();
    });
  });
}
