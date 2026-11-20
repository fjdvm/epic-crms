"use server";

import { openUpload } from "@/features/files/reference";
import { directFileStorage, storageUrl } from "@/features/files/storage";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import { saveProductContent, type ProductContentResult, type PublishedImage } from "./product-content";

/**
 * Publishes one product's description, and its new image when Staff uploaded one (`imageReference` is the signed
 * reference the upload returned). Re-checks the Module here; the Role is checked again inside the save.
 * Not optimistic: the shop shows this to Customers, so the screen waits for this answer.
 */
export async function publishProductContent(productId: number, description: string, imageReference: string | null): Promise<ProductContentResult> {
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
    return await saveProductContent(crmsDatabase(), gatewayAuditTrail, staff, { productId, description, image });
  } catch (error) {
    console.error("Product content could not be published", error);
    return { ok: false, reason: "CREOMS could not publish that. Try again in a moment." };
  }
}
