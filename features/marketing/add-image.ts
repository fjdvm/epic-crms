import sharp from "sharp";

import type { Actor, Ports } from "./announcements";
import { IMAGE_WIDTH, MAX_IMAGE_BYTES, type AddImageResult } from "./image-limits";

/**
 * Shrinks a Staff member's image and stores it, returning its public address. Only the shrunk copy is
 * kept, as a JPEG (the format every mail app shows). It is not attached to any Announcement until the
 * Draft is saved with it, so an Announcement not yet saved can have images too.
 */
export async function addImage(
  actor: Actor,
  file: { filename: string; bytes: Uint8Array },
  ports: Ports,
): Promise<AddImageResult> {
  if (file.bytes.length === 0) return { ok: false, reason: "empty-image" };
  if (file.bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "image-too-large" };

  let shrunk: Buffer;
  try {
    // Transparent areas go white, as an email's background is; the EXIF orientation is applied.
    shrunk = await sharp(file.bytes, { animated: false })
      .rotate()
      .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    return { ok: false, reason: "not-an-image" };
  }

  try {
    return { ok: true, url: await ports.images.store({ contentType: "image/jpeg", bytes: shrunk }) };
  } catch (error) {
    console.error(`Announcement image from ${actor.id} could not be stored`, error);

    return { ok: false, reason: "storage-unavailable" };
  }
}
