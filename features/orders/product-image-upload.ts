import { checkFileInfo, type FileFailure, type FileInfo } from "@/features/files/policy";

const FAILED: FileFailure = { ok: false, reason: "The image could not be uploaded. Please try again." };

/**
 * Sends a product image to CREOMS, which checks it and stores it for the shop (`/api/orders/product-image`). The answer is
 * the reference the publish takes. The type and size are checked here first, so a wrong file never leaves the browser.
 */
export async function uploadProductImage(file: File, send: typeof fetch = fetch): Promise<{ ok: true; reference: string } | FileFailure> {
  const reason = checkFileInfo("Orders", { filename: file.name, contentType: file.type as FileInfo["contentType"], size: file.size });
  if (reason) return { ok: false, reason };
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await send("/api/orders/product-image", { method: "POST", body: form, credentials: "same-origin" });
    const body = await response.json().catch(() => null) as { ok?: boolean; reference?: unknown; reason?: unknown } | null;
    if (body?.ok === true && typeof body.reference === "string") return { ok: true, reference: body.reference };
    return typeof body?.reason === "string" ? { ok: false, reason: body.reason } : FAILED;
  } catch {
    return FAILED;
  }
}
