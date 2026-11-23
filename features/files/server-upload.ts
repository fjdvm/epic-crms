import { fileTypeFromBuffer } from "file-type";

import { checkFileInfo, filePolicy, type FileContentType, type FileFailure, type ReadyFile, type UploadModule } from "./policy";
import { sealUpload } from "./reference";
import { directFileStorage, storageUrl } from "./storage";

const unavailable = (): FileFailure => ({ ok: false, reason: "File storage is temporarily unavailable. Please try again." });
const CONTENTS_REASON = "The file's contents do not match its claimed type. Choose the correct file.";

/**
 * Stores an image whose bytes CREOMS already holds: they are checked here first (size and real type), then sent to the
 * storage-signed address by the server and confirmed, giving an ordinary ready reference. Used where the browser cannot
 * upload to storage itself: product images go to the public bucket, which does not accept uploads from the CREOMS page.
 */
export async function storeImageBytes(
  module: UploadModule, staffId: string, input: { filename: string; contentType: string; bytes: Uint8Array },
): Promise<ReadyFile | FileFailure> {
  const info = { filename: input.filename, contentType: input.contentType as FileContentType, size: input.bytes.length };
  const reason = checkFileInfo(module, info);
  if (reason) return { ok: false, reason };
  try {
    const actual = await fileTypeFromBuffer(input.bytes);
    const type = actual?.mime === "image/apng" ? "image/png" : actual?.mime;
    if (type !== info.contentType) return { ok: false, reason: CONTENTS_REASON };
  } catch {
    return { ok: false, reason: CONTENTS_REASON };
  }

  let fileId: string | null = null;
  try {
    const policy = filePolicy(module);
    const pending = await directFileStorage.request({ ...info, ...policy });
    fileId = pending.id;
    const sent = await fetch(storageUrl(pending.uploadUrl), {
      method: "PUT", headers: { "Content-Type": info.contentType }, body: input.bytes as BodyInit,
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!sent.ok) throw new Error(`Storage refused the upload: ${sent.status}`);
    const confirmed = await directFileStorage.confirm(pending.id);
    const matches = confirmed.id === pending.id && confirmed.status === "active" && confirmed.contentType === info.contentType &&
      confirmed.size === info.size && confirmed.visibility === policy.visibility && confirmed.retentionType === policy.retentionType;
    if (!matches) throw new Error("The stored file does not match what was sent");
    return {
      ok: true, ...info,
      reference: sealUpload({ ...info, module, staffId, context: { ticketId: null }, fileId: pending.id, phase: "ready", expires: Date.now() + 60 * 60_000 }),
    };
  } catch (error) {
    console.error(`File storage could not store an image for ${module}`, error);
    if (fileId) await directFileStorage.remove(fileId).catch(() => undefined);
    return unavailable();
  }
}
