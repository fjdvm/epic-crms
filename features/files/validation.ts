import sharp from "sharp";
import { IMAGE_REFUSALS, IMAGE_WIDTH } from "@/features/marketing/image-limits";
import { fileTypeFromBuffer } from "file-type";
import { MAX_FILE_BYTES, type FileInfo, type UploadModule } from "./policy";
import { storageUrl } from "./storage";

/** Bounded reads also cover a storage response that lies about Content-Length. */
export async function validateStoredFile(url: string, file: FileInfo, module: UploadModule): Promise<string | null> {
  const response = await fetch(storageUrl(url), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error("File bytes could not be read");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_FILE_BYTES || size > file.size) {
        await reader.cancel();
        return size > MAX_FILE_BYTES ? "That file is over 25 MB. Choose a smaller file." : "The uploaded file does not match its declared size.";
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  if (size === 0) return "That file is empty. Choose a file with something in it.";
  if (size !== file.size) return "The uploaded file does not match its declared size.";
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const actual = await fileTypeFromBuffer(bytes);
    const type = actual?.mime === "image/apng" ? "image/png" : actual?.mime;
    if (type !== file.contentType) return "The file's contents do not match its claimed type. Choose the correct file.";
    if (module === "Marketing") {
      try {
        // Decode the entire image, as the former Announcement path did. A recognized header is insufficient.
        await sharp(bytes, { animated: false }).rotate().resize({ width: IMAGE_WIDTH, withoutEnlargement: true }).jpeg().toBuffer();
      } catch {
        return IMAGE_REFUSALS["not-an-image"];
      }
    }
    return null;
  } catch {
    return "The file's contents could not be verified. Choose a valid file.";
  }
}
