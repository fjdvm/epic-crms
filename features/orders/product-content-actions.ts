"use server";

import { openUpload } from "@/features/files/reference";
import { directFileStorage, storageUrl } from "@/features/files/storage";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { approvals } from "@/features/approvals/server";
import { nudgeStorefront } from "@/features/management/storefront-nudge";

import { applyProductPrice, removeProductFromStore, saveProductContent, type ProductContentResult, type PublishedImage } from "./product-content";
import { parsePrice } from "./product-content-limits";

/** Open storefront pages refetch what they show; a failed nudge never undoes a save. */
const tellStorefront = () => nudgeStorefront().catch((error) => console.error("The storefront could not be told about a product change", error));

/**
 * Publishes one product's description, and its new image when Staff uploaded one (`imageReference` is the signed
 * reference the upload returned). Re-checks the Module here; the Role is checked again inside the save.
 * Not optimistic: the shop shows this to Customers, so the screen waits for this answer.
 */
export async function publishProductContent(productId: number, description: string, imageReference: string | null, name?: string | null): Promise<ProductContentResult> {
  const staff = await requireModule(ORDERS_MODULE);
  try {
    let image: PublishedImage | undefined;
    if (imageReference !== null) {
      const upload = openUpload(imageReference);
      if (!upload || upload.module !== ORDERS_MODULE || upload.staffId !== staff.username || upload.phase !== "ready") {
        return { ok: false, reason: "That image upload is invalid or expired. Add the image again." };
      }
      const file = await directFileStorage.view(upload.fileId);
      if (file.id !== upload.fileId || file.status !== "active" || file.visibility !== "public") {
        return { ok: false, reason: "That image upload is invalid or expired. Add the image again." };
      }
      image = { fileId: file.id, url: storageUrl(file.url) };
    }
    const result = await saveProductContent(crmsDatabase(), gatewayAuditTrail, staff, { productId, description, image, name });
    if (result.ok) await tellStorefront();
    return result;
  } catch (error) {
    console.error("Product content could not be published", error);
    return { ok: false, reason: "CREOMS could not publish that. Try again in a moment." };
  }
}

/**
 * Takes one product off the shop; publishing it again puts it back. Not optimistic: Customers stop seeing it, so the
 * screen waits for this answer. The Role is checked again inside.
 */
export async function removeFromStore(productId: number): Promise<ProductContentResult> {
  const staff = await requireModule(ORDERS_MODULE);
  try {
    const result = await removeProductFromStore(crmsDatabase(), gatewayAuditTrail, staff, { productId });
    if (result.ok) await tellStorefront();
    return result;
  } catch (error) {
    console.error("A product could not be removed from the store", error);
    return { ok: false, reason: "CREOMS could not remove that. Try again in a moment." };
  }
}

export type ProductPriceResult = ProductContentResult | { ok: false; reason: "Waiting for approval"; approvalId?: string; status?: string };

/**
 * Sets one product's shop price, in CREOMS only. The price is money: a Manager-level person sets it at once; Staff
 * send it to a Manager with a reason (`reason`), and it is set when a Manager approves. Never optimistic.
 */
export async function setProductPrice(productId: number, price: string | number, reason?: string): Promise<ProductPriceResult> {
  const staff = await requireModule(ORDERS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(productId) || productId < 1) return { ok: false, reason: "That product could not be found." };
  const pesos = parsePrice(price);
  if (pesos === null) return { ok: false, reason: "Enter a price above ₱0 with at most two decimals." };
  try {
    const result = await approvals().run(staff, {
      module: ORDERS_MODULE, action: "product.price", targetId: String(productId), payload: { price: pesos }, amountInCentavos: Math.round(pesos * 100),
    }, { reason }, () => applyProductPrice(crmsDatabase(), gatewayAuditTrail, staff, { productId, price: pesos }));
    if (result.ok) await tellStorefront();
    return result as ProductPriceResult;
  } catch (error) {
    console.error("The shop price could not be set", error);
    return { ok: false, reason: "CREOMS could not set that price. Try again in a moment." };
  }
}
