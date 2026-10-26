"use client";

import { confirmFileUpload, requestFileUpload } from "./actions";
import { checkFileInfo, type FileFailure, type FileInfo, type ReadyFile, type UploadContext, type UploadModule } from "./policy";

/** No File/Blob crosses a CREOMS Server Action: only metadata and signed references do. */
export async function uploadFile(module: UploadModule, file: File, context: UploadContext = { ticketId: null }): Promise<ReadyFile | FileFailure> {
  const info: FileInfo = { filename: file.name, contentType: file.type as FileInfo["contentType"], size: file.size };
  const reason = checkFileInfo(module, info);
  if (reason) return { ok: false, reason };
  const pending = await requestFileUpload(module, info, context);
  if (!pending.ok) return pending;
  try {
    const response = await fetch(pending.uploadUrl, {
      method: "PUT", headers: { "Content-Type": info.contentType }, body: file, credentials: "omit", redirect: "error",
    });
    if (!response.ok) return { ok: false, reason: "The file could not be uploaded. Please try again." };
  } catch { return { ok: false, reason: "The file could not be uploaded. Please try again." }; }
  return confirmFileUpload(module, pending.reference);
}
