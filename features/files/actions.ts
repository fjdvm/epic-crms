"use server";

import { canManage, canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { checkFileInfo, filePolicy, isUploadModule, type FileFailure, type FileInfo, type ReadyFile, type UploadContext, type UploadModule } from "./policy";
import { openUpload, sealUpload } from "./reference";
import { directFileStorage, storageUrl } from "./storage";
import { validateStoredFile } from "./validation";
import { downloadLinkImage, LINK_INVALID_REASON } from "./link-download";

const unavailable = (): FileFailure => ({ ok: false, reason: "File storage is temporarily unavailable. Please try again." });
const MANAGE_REASON = "Only a Manager or the CEO can manage Payment accounts.";
const invalid = (): FileFailure => ({ ok: false, reason: "That upload reference is invalid or expired. Attach the file again." });

export async function requestFileUpload(module: UploadModule, file: FileInfo, context: UploadContext = { ticketId: null }): Promise<({ ok: true; reference: string; uploadUrl: string }) | FileFailure> {
  if (!isUploadModule(module)) return invalid();
  const staff = await requireModule(module);
  const reason = checkFileInfo(module, file);
  if (reason) return { ok: false, reason };
  if (!context || (context.ticketId !== null && (!Number.isSafeInteger(context.ticketId) || context.ticketId < 1))) return invalid();
  file = { filename: file.filename, contentType: file.contentType, size: file.size };
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (module === "Management" && !canManage(staff)) return { ok: false, reason: MANAGE_REASON };
  try {
    // Check the signing key before creating a remote File.
    sealUpload({ ...file, module, staffId: staff.username, context, fileId: "", phase: "pending", expires: Date.now() + 30 * 60_000 });
    const pending = await directFileStorage.request({ ...file, ...filePolicy(module) });
    return { ok: true, uploadUrl: storageUrl(pending.uploadUrl), reference: sealUpload({ ...file, module, staffId: staff.username,
      context: { ticketId: context.ticketId }, fileId: pending.id, phase: "pending", expires: Date.now() + 30 * 60_000 }) };
  } catch { return unavailable(); }
}

export async function confirmFileUpload(module: UploadModule, reference: string): Promise<ReadyFile | FileFailure> {
  if (!isUploadModule(module)) return invalid();
  const staff = await requireModule(module);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (module === "Management" && !canManage(staff)) return { ok: false, reason: MANAGE_REASON };
  try {
    const upload = openUpload(reference);
    if (!upload || upload.module !== module || upload.staffId !== staff.username || upload.phase !== "pending") return invalid();
    const confirmed = await directFileStorage.confirm(upload.fileId);
    const policy = filePolicy(module);
    const matches = confirmed.id === upload.fileId && confirmed.status === "active" && confirmed.contentType === upload.contentType &&
      confirmed.size === upload.size && confirmed.visibility === policy.visibility && confirmed.retentionType === policy.retentionType;
    const reason = matches ? await validateStoredFile((await directFileStorage.view(upload.fileId)).url, upload, module) : "The uploaded file does not match its declared size or type.";
    if (reason) {
      try { await directFileStorage.remove(upload.fileId); }
      catch { return { ok: false, reason: `${reason} It could not be removed; try confirmation again.`, cleanupFailed: true }; }
      return { ok: false, reason };
    }
    return { ok: true, filename: upload.filename, contentType: upload.contentType, size: upload.size,
      reference: sealUpload({ ...upload, phase: "ready", expires: Date.now() + 60 * 60_000 }) };
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 422) {
      return { ok: false, reason: "The uploaded file does not match its declared size or type. Upload it again." };
    }
    return unavailable();
  }
}

/**
 * A Delivery photo from the image link Staff copied from Lalamove or Grab. The server downloads it (public https hosts
 * only, JPG/PNG up to 5 MB) and stores it through the same request → upload → confirm steps as a browser upload, so the
 * result is an ordinary ready Fulfilment reference for `deliverOrder`.
 */
export async function importDeliveryPhotoLink(link: string): Promise<ReadyFile | FileFailure> {
  const staff = await requireModule("Fulfilment");
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (typeof link !== "string") return { ok: false, reason: LINK_INVALID_REASON };
  const image = await downloadLinkImage(link);
  if (!image.ok) return image;
  const pending = await requestFileUpload("Fulfilment", { filename: image.filename, contentType: image.contentType, size: image.bytes.length });
  if (!pending.ok) return pending;
  try {
    const response = await fetch(pending.uploadUrl, {
      method: "PUT", headers: { "Content-Type": image.contentType }, body: image.bytes as BodyInit, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return unavailable();
  } catch { return unavailable(); }
  return confirmFileUpload("Fulfilment", pending.reference);
}

export async function getFileView(module: UploadModule, reference: string): Promise<({ ok: true; url: string } & FileInfo) | FileFailure> {
  if (!isUploadModule(module)) return invalid();
  const staff = await requireModule(module);
  if (module === "Management" && !canManage(staff)) return { ok: false, reason: MANAGE_REASON };
  try {
    const upload = openUpload(reference);
    if (!upload || upload.module !== module || upload.phase !== "ready") return invalid();
    const file = await directFileStorage.view(upload.fileId);
    if (file.id !== upload.fileId || file.status !== "active") return invalid();
    return { ok: true, url: storageUrl(file.url), filename: file.filename, contentType: file.contentType, size: file.size };
  } catch { return unavailable(); }
}
