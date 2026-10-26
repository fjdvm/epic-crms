// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestFileUpload, confirmFileUpload } from "@/features/files/actions";
import { FulfilmentMove } from "@/features/orders/fulfilment-moves";
import { deliverOrder } from "@/features/orders/actions";
import { ReturnActions } from "@/features/returns/return-actions";
import { markReturnRefunded } from "@/features/returns/actions";
import { CampaignForm, type CampaignFormActions } from "@/features/marketing/campaign-form";

vi.mock("@/features/files/actions", () => ({ requestFileUpload: vi.fn(), confirmFileUpload: vi.fn() }));
vi.mock("@/features/orders/actions", () => ({ deliverOrder: vi.fn(), dispatchOrder: vi.fn(), startPreparing: vi.fn() }));
vi.mock("@/features/returns/actions", () => ({
  approveReturn: vi.fn(), declineReturn: vi.fn(), markReturnGoodsReceived: vi.fn(), markReturnRefunded: vi.fn(), markReturnReplaced: vi.fn(),
}));
vi.mock("@/features/marketing/prepare-image", () => ({ prepareImage: async (file: File) => file }));
const { toast, refresh, push } = vi.hoisted(() => ({ toast: { error: vi.fn(), success: vi.fn() }, refresh: vi.fn(), push: vi.fn() }));
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
  vi.mocked(markReturnRefunded).mockResolvedValue({ ok: true, return: { id: 15, status: "refunded" } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const evidence = [
  {
    module: "Fulfilment", label: "Delivery photo", trigger: "Mark as delivered", field: "photo", id: 1042,
    render: () => render(<FulfilmentMove order={{ id: 1042, status: "dispatched", paymentMethod: "gcash" }} />),
    submit: deliverOrder,
  },
  {
    module: "Returns", label: "Refund proof", trigger: "Mark refunded", field: "proof", id: 15,
    render: () => render(<ReturnActions id={15} number="RMA-15" status="goods received" goodsRequired preferredResolution="refund" finalResolution="refund" />),
    submit: markReturnRefunded,
  },
] as const;

function pick(label: string, file: File) {
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
      fireEvent.click(within(dialog).getByRole("button", { name: picker.trigger }));
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
      expect(Array.from((form as FormData).entries())).toEqual([[picker.field, "ready-reference"]]);
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

function campaign() {
  const actions: CampaignFormActions = {
    save: vi.fn(async () => ({ ok: true as const, announcement: { id: "draft" } })),
    edit: vi.fn(async () => ({ ok: true as const })), remove: vi.fn(async () => ({ ok: true as const })),
    sendTest: vi.fn(async () => ({ ok: true as const })),
    addImage: vi.fn(async () => ({ ok: true as const, url: "https://cdn.test/door.png" })),
    send: vi.fn(async () => ({ ok: true as const, state: "sent" as const, subscribers: 1 })),
    schedule: vi.fn(async () => ({ ok: true as const })), unschedule: vi.fn(async () => ({ ok: true as const })),
  };
  render(<CampaignForm actions={actions} />);
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Halaya" } });
  fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Restocked." } });
  return actions;
}

describe("Announcement image direct upload", () => {
  it("uploads bytes to storage, previews the resolved image and waits for confirmation before saving", async () => {
    const actions = campaign();
    const file = photo();
    pick("Add images", file);
    await screen.findByRole("button", { name: "Remove image 1" });
    expect(requestFileUpload).toHaveBeenCalledWith("Marketing", { filename: "door.png", contentType: "image/png", size: 4 }, { ticketId: null });
    expect(put).toHaveBeenCalledWith(storageUrl, expect.objectContaining({ method: "PUT", body: file }));
    expect(confirmFileUpload).toHaveBeenCalledWith("Marketing", "pending-reference");
    const form = vi.mocked(actions.addImage).mock.calls[0][0];
    expect(Array.from(form.entries())).toEqual([["image", "ready-reference"]]);
    expect(within(screen.getByTestId("inbox-preview")).getByRole("img", { name: "Image 1" }).getAttribute("src")).toBe("https://cdn.test/door.png");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(actions.save).not.toHaveBeenCalled();
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith({ title: "Halaya", description: "Restocked.", images: ["https://cdn.test/door.png"] }));
  });

  it.each(["request", "PUT", "confirmation"] as const)("keeps earlier images when %s fails and allows a retry", async (stage) => {
    const actions = campaign();
    pick("Add images", photo());
    await screen.findByRole("button", { name: "Remove image 1" });
    const reason = "The uploaded file does not match its declared size or type.";
    if (stage === "request") vi.mocked(requestFileUpload).mockResolvedValueOnce({ ok: false, reason });
    if (stage === "PUT") put.mockResolvedValueOnce(new Response(null, { status: 403 }));
    if (stage === "confirmation") vi.mocked(confirmFileUpload).mockResolvedValueOnce({ ok: false, reason });
    pick("Add images", photo());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(`door.png: ${stage === "PUT" ? "The file could not be uploaded. Please try again." : reason}`));
    expect(actions.addImage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Remove image 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove image 2" })).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Add images").hasAttribute("disabled")).toBe(false));
    pick("Add images", photo());
    await screen.findByRole("button", { name: "Remove image 2" });
    expect(actions.addImage).toHaveBeenCalledTimes(2);
    expect(actions.save).not.toHaveBeenCalled();
  });
});
